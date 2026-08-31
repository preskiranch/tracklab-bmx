import AVFoundation
import Capacitor
import ImageIO
import ReplayKit
import UIKit
import WebKit
import WebRTC

/// Publishes TrackLab's visible activity screen directly to an authenticated
/// Club Live viewer over WebRTC. Media is DTLS-SRTP encrypted and travels
/// peer-to-peer; TrackLab's server relays signaling only.
@objc(ClubLiveVideoStreamPlugin)
public final class ClubLiveVideoStreamPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClubLiveVideoStreamPlugin"
    public let jsName = "TrackLabClubLiveVideoStream"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setActivityVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createPeer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRemoteDescription", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addIceCandidate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closePeer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAll", returnType: CAPPluginReturnPromise),
    ]

    private static let activityScreenVisibleScript =
        "document.querySelector('[data-club-live-activity-screen=\"visible\"]') !== null"
    private static let maximumPeers = 2
    private static let maximumPeerIdLength = 120
    private static let maximumSdpLength = 64 * 1_024
    private static let maximumCandidateLength = 4 * 1_024
    private static let targetFramesPerSecond = 60
    private static let maximumBitrateBps = 40_000_000

    private let factory: RTCPeerConnectionFactory
    private let videoSource: RTCVideoSource
    private let videoTrack: RTCVideoTrack
    private lazy var capturer = RTCVideoCapturer(delegate: videoSource)
    private var peers: [String: ClubLivePeer] = [:]
    private var activityVisible = false
    private var captureActive = false
    private var captureStarting = false
    private var captureGeneration = 0
    private let captureStateLock = NSLock()
    /// Read and written only while `captureStateLock` is held. This prevents a
    /// final ReplayKit buffer from an ended activity entering a newer stream.
    private var acceptedCaptureGeneration = 0
    private var privacyTimer: Timer?
    private var statsTimer: Timer?
    private var framesInStatsWindow = 0
    private var statsWindowStartedAt = CACurrentMediaTime()
    private var lastFrameTimestampNs: Int64 = 0
    private var observers: [NSObjectProtocol] = []

    public override init() {
        RTCInitializeSSL()
        let encoderFactory = RTCDefaultVideoEncoderFactory()
        let decoderFactory = RTCDefaultVideoDecoderFactory()
        factory = RTCPeerConnectionFactory(
            encoderFactory: encoderFactory,
            decoderFactory: decoderFactory
        )
        videoSource = factory.videoSource(forScreenCast: true)
        videoTrack = factory.videoTrack(with: videoSource, trackId: "tracklab-club-live-screen")
        super.init()
    }

    deinit {
        stopEverything(reason: "plugin-released")
        observers.forEach(NotificationCenter.default.removeObserver)
        RTCCleanupSSL()
    }

    public override func load() {
        super.load()
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.revokeActivityVisibility(reason: "app-inactive")
        })
        observers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.revokeActivityVisibility(reason: "app-backgrounded")
        })
    }

    @objc public func setActivityVisible(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("The TrackLab stream is unavailable.", "stream_unavailable")
                return
            }
            let visible = call.getBool("visible") ?? false
            self.activityVisible = visible
            if !visible {
                self.stopCaptureInternal(reason: "activity-hidden")
                self.closeAllPeers(reason: "activity-hidden")
            }
            call.resolve(["visible": visible])
        }
    }

    @objc public func startCapture(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("The TrackLab stream is unavailable.", "stream_unavailable")
                return
            }
            guard self.activityVisible else {
                call.reject("Only a visible TrackLab activity can be shared.", "activity_screen_not_visible")
                return
            }
            guard !self.captureStarting else {
                call.reject("TrackLab is already starting screen sharing.", "capture_starting")
                return
            }
            if self.captureActive {
                call.resolve(["active": true])
                return
            }
            guard RPScreenRecorder.shared().isAvailable else {
                call.reject("Screen sharing is unavailable on this device.", "capture_unavailable")
                return
            }
            guard let webView = self.webView else {
                call.reject("The TrackLab activity view is unavailable.", "view_unavailable")
                return
            }
            guard !self.peers.isEmpty else {
                call.reject("An authenticated club owner viewer is required.", "viewer_required")
                return
            }

            self.captureGeneration &+= 1
            let generation = self.captureGeneration
            self.captureStarting = true
            Self.activityScreenIsVisible(in: webView) { [weak self] markerVisible in
                DispatchQueue.main.async {
                    guard let self else {
                        call.reject("The TrackLab stream is unavailable.", "stream_unavailable")
                        return
                    }
                    guard self.captureGeneration == generation,
                          self.activityVisible,
                          markerVisible,
                          !self.peers.isEmpty else {
                        self.captureStarting = false
                        call.reject("Only a visible TrackLab activity with an owner viewer can be shared.", "activity_screen_not_visible")
                        return
                    }
                    let recorder = RPScreenRecorder.shared()
                    recorder.isMicrophoneEnabled = false
                    recorder.isCameraEnabled = false
                    self.beginAcceptingCaptureSamples(generation: generation)
                    recorder.startCapture(handler: { [weak self] sampleBuffer, sampleType, error in
                        if error != nil {
                            DispatchQueue.main.async {
                                guard let self, self.captureGeneration == generation else { return }
                                // ReplayKit can fail after startCapture has already
                                // resolved. Tear down this exact capture generation
                                // and its peers so JavaScript immediately restores
                                // the JPEG safety feed and the viewer renegotiates.
                                self.stopEverything(reason: "capture-failed")
                            }
                            return
                        }
                        guard sampleType == .video else { return }
                        self?.consumeVideoSample(sampleBuffer, generation: generation)
                    }, completionHandler: { [weak self] error in
                        DispatchQueue.main.async {
                            guard let self else {
                                call.reject("The TrackLab stream is unavailable.", "stream_unavailable")
                                return
                            }
                            guard self.captureGeneration == generation,
                                  self.activityVisible,
                                  !self.peers.isEmpty else {
                                self.captureStarting = false
                                self.captureActive = false
                                recorder.stopCapture { _ in }
                                call.reject("TrackLab screen sharing was cancelled.", "capture_cancelled")
                                return
                            }
                            self.captureStarting = false
                            if let error {
                                self.stopCaptureInternal(reason: "capture-failed")
                                call.reject("TrackLab could not start screen sharing.", "capture_failed", error)
                                return
                            }
                            self.captureActive = true
                            self.startPrivacyGuard()
                            self.startStatsTimer()
                            self.notifyListeners("captureState", data: [
                                "active": true,
                                "targetFps": Self.targetFramesPerSecond,
                            ])
                            call.resolve([
                                "active": true,
                                "targetFps": Self.targetFramesPerSecond,
                            ])
                        }
                    })
                }
            }
        }
    }

    @objc public func stopCapture(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.stopCaptureInternal(reason: "viewer-ended")
            call.resolve(["active": false])
        }
    }

    @objc public func createPeer(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("The TrackLab stream is unavailable.", "stream_unavailable")
                return
            }
            guard self.activityVisible else {
                call.reject("Only a visible TrackLab activity can be shared.", "activity_screen_not_visible")
                return
            }
            guard let peerId = Self.validPeerId(call.getString("peerId")) else {
                call.reject("A valid viewer identifier is required.", "invalid_peer")
                return
            }
            guard let negotiationId = Self.validPeerId(call.getString("negotiationId")) else {
                call.reject("A valid viewer negotiation is required.", "invalid_negotiation")
                return
            }
            if self.peers[peerId] != nil {
                self.closePeerInternal(peerId, reason: "peer-replaced")
            }
            guard self.peers.count < Self.maximumPeers else {
                call.reject("This tablet is already being viewed on the maximum number of owner displays.", "peer_limit")
                return
            }

            let configuration = RTCConfiguration()
            configuration.sdpSemantics = .unifiedPlan
            configuration.bundlePolicy = .maxBundle
            configuration.rtcpMuxPolicy = .require
            configuration.continualGatheringPolicy = .gatherContinually
            configuration.iceServers = Self.iceServers(call.getArray("iceServers", JSObject.self) ?? [])
            let constraints = RTCMediaConstraints(
                mandatoryConstraints: nil,
                optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
            )
            let delegate = ClubLivePeerDelegate(
                peerId: peerId,
                negotiationId: negotiationId
            ) { [weak self] event in
                self?.handlePeerEvent(event)
            }
            guard let peerConnection = self.factory.peerConnection(
                with: configuration,
                constraints: constraints,
                delegate: delegate
            ) else {
                call.reject("TrackLab could not create a secure viewer connection.", "peer_create_failed")
                return
            }
            guard let sender = peerConnection.add(self.videoTrack, streamIds: ["tracklab-club-live"]) else {
                peerConnection.close()
                call.reject("TrackLab could not attach the activity video.", "track_attach_failed")
                return
            }
            Self.configure(sender: sender)
            self.peers[peerId] = ClubLivePeer(
                connection: peerConnection,
                delegate: delegate,
                negotiationId: negotiationId
            )
            let offerConstraints = RTCMediaConstraints(
                mandatoryConstraints: [
                    "OfferToReceiveAudio": "false",
                    "OfferToReceiveVideo": "false",
                ],
                optionalConstraints: nil
            )
            peerConnection.offer(for: offerConstraints) { [weak self, weak peerConnection] description, error in
                DispatchQueue.main.async {
                    guard let self, let peerConnection else {
                        call.reject("The TrackLab viewer connection ended.", "peer_closed")
                        return
                    }
                    guard self.peers[peerId]?.negotiationId == negotiationId,
                          self.peers[peerId]?.connection === peerConnection else {
                        call.reject("The TrackLab viewer negotiation was replaced.", "peer_replaced")
                        return
                    }
                    if let error {
                        self.closePeerInternal(peerId, reason: "offer-failed")
                        call.reject("TrackLab could not prepare the video stream.", "offer_failed", error)
                        return
                    }
                    guard let description else {
                        self.closePeerInternal(peerId, reason: "offer-missing")
                        call.reject("TrackLab could not prepare the video stream.", "offer_failed")
                        return
                    }
                    peerConnection.setLocalDescription(description) { error in
                        DispatchQueue.main.async {
                            guard self.peers[peerId]?.negotiationId == negotiationId,
                                  self.peers[peerId]?.connection === peerConnection else {
                                call.reject("The TrackLab viewer negotiation was replaced.", "peer_replaced")
                                return
                            }
                            if let error {
                                self.closePeerInternal(peerId, reason: "local-description-failed")
                                call.reject("TrackLab could not secure the outgoing stream.", "local_description_failed", error)
                                return
                            }
                            call.resolve([
                                "peerId": peerId,
                                "negotiationId": negotiationId,
                                "type": "offer",
                                "sdp": description.sdp,
                            ])
                        }
                    }
                }
            }
        }
    }

    @objc public func setRemoteDescription(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  let peerId = Self.validPeerId(call.getString("peerId")),
                  let peer = self.peers[peerId],
                  let negotiationId = Self.validPeerId(call.getString("negotiationId")),
                  peer.negotiationId == negotiationId,
                  let typeText = call.getString("type"),
                  typeText == "answer",
                  let sdp = call.getString("sdp"),
                  !sdp.isEmpty,
                  sdp.utf8.count <= Self.maximumSdpLength else {
                call.reject("The viewer response is invalid.", "invalid_description")
                return
            }
            let description = RTCSessionDescription(type: .answer, sdp: sdp)
            peer.connection.setRemoteDescription(description) { error in
                if let error {
                    call.reject("TrackLab could not accept the viewer response.", "remote_description_failed", error)
                } else {
                    call.resolve(["peerId": peerId])
                }
            }
        }
    }

    @objc public func addIceCandidate(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  let peerId = Self.validPeerId(call.getString("peerId")),
                  let peer = self.peers[peerId],
                  let negotiationId = Self.validPeerId(call.getString("negotiationId")),
                  peer.negotiationId == negotiationId,
                  let sdp = call.getString("candidate"),
                  !sdp.isEmpty,
                  sdp.utf8.count <= Self.maximumCandidateLength else {
                call.reject("The viewer network candidate is invalid.", "invalid_candidate")
                return
            }
            let sdpMid = call.getString("sdpMid")
            let sdpMLineIndex = Int32(call.getInt("sdpMLineIndex") ?? 0)
            let candidate = RTCIceCandidate(
                sdp: sdp,
                sdpMLineIndex: sdpMLineIndex,
                sdpMid: sdpMid
            )
            peer.connection.add(candidate) { error in
                if let error {
                    call.reject("TrackLab could not add the viewer network path.", "candidate_failed", error)
                } else {
                    call.resolve(["peerId": peerId])
                }
            }
        }
    }

    @objc public func closePeer(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            if let peerId = Self.validPeerId(call.getString("peerId")),
               let peer = self?.peers[peerId] {
                let negotiationId = call.getString("negotiationId")
                    .flatMap(Self.validPeerId)
                if negotiationId == nil || negotiationId == peer.negotiationId {
                    self?.closePeerInternal(peerId, reason: "viewer-ended")
                }
            }
            call.resolve()
        }
    }

    @objc public func stopAll(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.stopEverything(reason: "session-ended")
            call.resolve()
        }
    }

    private func consumeVideoSample(_ sampleBuffer: CMSampleBuffer, generation: Int) {
        guard CMSampleBufferIsValid(sampleBuffer),
              let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let timestampNs: Int64
        if timestamp.isValid && timestamp.timescale > 0 {
            timestampNs = Int64((CMTimeGetSeconds(timestamp) * 1_000_000_000).rounded())
        } else {
            timestampNs = Int64((CACurrentMediaTime() * 1_000_000_000).rounded())
        }
        let minimumInterval = Int64(1_000_000_000 / Self.targetFramesPerSecond)
        captureStateLock.lock()
        guard acceptedCaptureGeneration == generation,
              timestampNs > lastFrameTimestampNs,
              timestampNs - lastFrameTimestampNs >= minimumInterval - 1_000_000 else {
            captureStateLock.unlock()
            return
        }
        lastFrameTimestampNs = timestampNs
        let frame = RTCVideoFrame(
            buffer: RTCCVPixelBuffer(pixelBuffer: imageBuffer),
            rotation: Self.videoRotation(sampleBuffer),
            timeStampNs: timestampNs
        )
        // Keep the generation lock through delivery. A stop/new-start waits
        // until this frame has entered only the peers belonging to its capture.
        videoSource.capturer(capturer, didCapture: frame)
        captureStateLock.unlock()
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  self.captureGeneration == generation,
                  self.captureActive else { return }
            self.framesInStatsWindow += 1
        }
    }

    private func beginAcceptingCaptureSamples(generation: Int) {
        captureStateLock.lock()
        acceptedCaptureGeneration = generation
        lastFrameTimestampNs = 0
        captureStateLock.unlock()
    }

    private func stopAcceptingCaptureSamples() {
        captureStateLock.lock()
        acceptedCaptureGeneration = 0
        lastFrameTimestampNs = 0
        captureStateLock.unlock()
    }

    private func startPrivacyGuard() {
        privacyTimer?.invalidate()
        privacyTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self, self.captureActive else { return }
            guard self.activityVisible, let webView = self.webView else {
                self.revokeActivityVisibility(reason: "activity-hidden")
                return
            }
            Self.activityScreenIsVisible(in: webView) { [weak self] visible in
                DispatchQueue.main.async {
                    guard let self, self.captureActive, !visible else { return }
                    self.revokeActivityVisibility(reason: "activity-hidden")
                }
            }
        }
        RunLoop.main.add(privacyTimer!, forMode: .common)
    }

    private func startStatsTimer() {
        statsTimer?.invalidate()
        framesInStatsWindow = 0
        statsWindowStartedAt = CACurrentMediaTime()
        statsTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, self.captureActive else { return }
            let now = CACurrentMediaTime()
            let seconds = max(0.001, now - self.statsWindowStartedAt)
            let fps = Double(self.framesInStatsWindow) / seconds
            self.framesInStatsWindow = 0
            self.statsWindowStartedAt = now
            self.notifyListeners("streamStats", data: [
                "capturedFps": fps,
                "peerCount": self.peers.count,
            ])
        }
        RunLoop.main.add(statsTimer!, forMode: .common)
    }

    private func stopCaptureInternal(reason: String) {
        let wasStarting = captureStarting
        let wasActive = captureActive || RPScreenRecorder.shared().isRecording
        captureGeneration &+= 1
        privacyTimer?.invalidate()
        privacyTimer = nil
        statsTimer?.invalidate()
        statsTimer = nil
        if !wasStarting {
            captureStarting = false
        }
        captureActive = false
        stopAcceptingCaptureSamples()
        if RPScreenRecorder.shared().isRecording {
            RPScreenRecorder.shared().stopCapture { _ in }
        }
        if wasStarting || wasActive {
            notifyListeners("captureState", data: ["active": false, "reason": reason])
        }
    }

    private func closePeerInternal(_ peerId: String, reason: String) {
        guard let peer = peers.removeValue(forKey: peerId) else { return }
        peer.connection.delegate = nil
        peer.connection.close()
        notifyListeners("peerState", data: [
            "peerId": peerId,
            "negotiationId": peer.negotiationId,
            "state": "closed",
            "reason": reason,
        ])
        if peers.isEmpty {
            stopCaptureInternal(reason: "no-viewers")
        }
    }

    private func closeAllPeers(reason: String) {
        Array(peers.keys).forEach { closePeerInternal($0, reason: reason) }
    }

    private func stopEverything(reason: String) {
        stopCaptureInternal(reason: reason)
        closeAllPeers(reason: reason)
    }

    private func revokeActivityVisibility(reason: String) {
        activityVisible = false
        stopEverything(reason: reason)
    }

    private func handlePeerEvent(_ event: ClubLivePeerEvent) {
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  self.peers[event.peerId]?.negotiationId == event.negotiationId else { return }
            switch event.payload {
            case .candidate(let candidate):
                self.notifyListeners("iceCandidate", data: [
                    "peerId": event.peerId,
                    "negotiationId": event.negotiationId,
                    "candidate": candidate.sdp,
                    "sdpMid": candidate.sdpMid as Any,
                    "sdpMLineIndex": candidate.sdpMLineIndex,
                ])
            case .state(let state):
                self.notifyListeners("peerState", data: [
                    "peerId": event.peerId,
                    "negotiationId": event.negotiationId,
                    "state": Self.connectionStateText(state),
                ])
                if state == .failed || state == .closed {
                    self.closePeerInternal(event.peerId, reason: "connection-ended")
                }
            }
        }
    }

    private static func activityScreenIsVisible(
        in webView: WKWebView,
        completion: @escaping (Bool) -> Void
    ) {
        webView.evaluateJavaScript(activityScreenVisibleScript) { result, error in
            guard error == nil else {
                completion(false)
                return
            }
            if let visible = result as? Bool {
                completion(visible)
            } else if let visible = result as? NSNumber {
                completion(visible.boolValue)
            } else {
                completion(false)
            }
        }
    }

    private static func validPeerId(_ value: String?) -> String? {
        guard let value else { return nil }
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty,
              cleaned.count <= maximumPeerIdLength,
              cleaned.range(of: "^[A-Za-z0-9:_-]+$", options: .regularExpression) != nil else { return nil }
        return cleaned
    }

    private static func iceServers(_ values: [JSObject]) -> [RTCIceServer] {
        let parsed = values.prefix(4).compactMap { value -> RTCIceServer? in
            let urls: [String]
            if let array = value["urls"] as? [String] {
                urls = Array(array.prefix(4)).filter { $0.hasPrefix("stun:") || $0.hasPrefix("turn:") || $0.hasPrefix("turns:") }
            } else if let url = value["urls"] as? String,
                      url.hasPrefix("stun:") || url.hasPrefix("turn:") || url.hasPrefix("turns:") {
                urls = [url]
            } else {
                urls = []
            }
            guard !urls.isEmpty else { return nil }
            let username = value["username"] as? String
            let credential = value["credential"] as? String
            if username != nil || credential != nil {
                return RTCIceServer(
                    urlStrings: urls,
                    username: username,
                    credential: credential
                )
            }
            return RTCIceServer(urlStrings: urls)
        }
        // A public STUN server is free and is only used to discover network
        // paths. On the studio LAN WebRTC normally selects a direct host path.
        return parsed.isEmpty
            ? [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
            : parsed
    }

    private static func configure(sender: RTCRtpSender) {
        let parameters = sender.parameters
        parameters.degradationPreference = NSNumber(value: RTCDegradationPreference.maintainResolution.rawValue)
        parameters.encodings.forEach { encoding in
            encoding.maxBitrateBps = NSNumber(value: maximumBitrateBps)
            encoding.maxFramerate = NSNumber(value: targetFramesPerSecond)
            encoding.scaleResolutionDownBy = NSNumber(value: 1)
            encoding.bitratePriority = 2
            encoding.networkPriority = .high
        }
        sender.parameters = parameters
    }

    private static func videoRotation(_ sampleBuffer: CMSampleBuffer) -> RTCVideoRotation {
        guard let value = CMGetAttachment(
            sampleBuffer,
            key: RPVideoSampleOrientationKey as CFString,
            attachmentModeOut: nil
        ) as? NSNumber,
              let orientation = CGImagePropertyOrientation(rawValue: UInt32(value.uintValue)) else {
            return ._0
        }
        switch orientation {
        case .right, .rightMirrored: return ._90
        case .down, .downMirrored: return ._180
        case .left, .leftMirrored: return ._270
        default: return ._0
        }
    }

    private static func connectionStateText(_ state: RTCPeerConnectionState) -> String {
        switch state {
        case .new: return "new"
        case .connecting: return "connecting"
        case .connected: return "connected"
        case .disconnected: return "disconnected"
        case .failed: return "failed"
        case .closed: return "closed"
        @unknown default: return "unknown"
        }
    }
}

private final class ClubLivePeer {
    let connection: RTCPeerConnection
    let delegate: ClubLivePeerDelegate
    let negotiationId: String

    init(
        connection: RTCPeerConnection,
        delegate: ClubLivePeerDelegate,
        negotiationId: String
    ) {
        self.connection = connection
        self.delegate = delegate
        self.negotiationId = negotiationId
    }
}

private struct ClubLivePeerEvent {
    enum Payload {
        case candidate(RTCIceCandidate)
        case state(RTCPeerConnectionState)
    }

    let peerId: String
    let negotiationId: String
    let payload: Payload
}

private final class ClubLivePeerDelegate: NSObject, RTCPeerConnectionDelegate {
    private let peerId: String
    private let negotiationId: String
    private let onEvent: (ClubLivePeerEvent) -> Void

    init(
        peerId: String,
        negotiationId: String,
        onEvent: @escaping (ClubLivePeerEvent) -> Void
    ) {
        self.peerId = peerId
        self.negotiationId = negotiationId
        self.onEvent = onEvent
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        onEvent(ClubLivePeerEvent(
            peerId: peerId,
            negotiationId: negotiationId,
            payload: .candidate(candidate)
        ))
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        onEvent(ClubLivePeerEvent(
            peerId: peerId,
            negotiationId: negotiationId,
            payload: .state(newState)
        ))
    }
}
