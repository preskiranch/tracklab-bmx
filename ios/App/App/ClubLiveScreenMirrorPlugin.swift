import Capacitor
import UIKit
import WebKit

/// Captures only TrackLab's own WKWebView for the Club Live monitor. This does
/// not use ReplayKit, camera, microphone, or any device-wide screen API.
@objc(ClubLiveScreenMirrorPlugin)
public final class ClubLiveScreenMirrorPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClubLiveScreenMirrorPlugin"
    public let jsName = "TrackLabClubLiveScreenMirror"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise),
    ]

    private static let maximumPixelEdge: CGFloat = 1_280
    private static let maximumJpegBytes = 350 * 1_024
    private static let jpegQualities: [CGFloat] = [0.6, 0.52, 0.44, 0.36, 0.28]
    private static let activityScreenVisibleScript =
        "document.querySelector('[data-club-live-activity-screen=\"visible\"]') !== null"
    private var captureInFlight = false

    @objc public func capture(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("The TrackLab view is unavailable.", "view_unavailable")
                return
            }
            guard !self.captureInFlight else {
                call.reject("A TrackLab view capture is already in progress.", "capture_in_progress")
                return
            }
            guard let webView = self.webView else {
                call.reject("The TrackLab view is not visible.", "view_unavailable")
                return
            }

            self.captureInFlight = true
            Self.activityScreenIsVisible(in: webView) { [weak self, weak webView] activityVisible in
                DispatchQueue.main.async {
                    guard let self else {
                        call.reject("The TrackLab view is unavailable.", "view_unavailable")
                        return
                    }
                    guard activityVisible,
                          let webView,
                          let visibleRect = Self.visibleRect(for: webView) else {
                        self.captureInFlight = false
                        call.reject("Only a visible TrackLab activity screen can be shared.", "activity_screen_not_visible")
                        return
                    }

                    let configuration = WKSnapshotConfiguration()
                    configuration.rect = visibleRect
                    configuration.afterScreenUpdates = true

                    webView.takeSnapshot(with: configuration) { [weak self, weak webView] image, error in
                        DispatchQueue.main.async {
                            guard let self else {
                                call.reject("The TrackLab view is unavailable.", "view_unavailable")
                                return
                            }
                            guard error == nil, let image, let webView else {
                                self.captureInFlight = false
                                call.reject("TrackLab could not capture its app view.", "capture_failed", error)
                                return
                            }

                            // Re-check after the asynchronous snapshot. This prevents a
                            // frame from being returned if the athlete opened an account,
                            // membership, or another non-activity screen mid-capture.
                            Self.activityScreenIsVisible(in: webView) { [weak self] stillVisible in
                                DispatchQueue.main.async {
                                    guard let self else {
                                        call.reject("The TrackLab view is unavailable.", "view_unavailable")
                                        return
                                    }
                                    defer { self.captureInFlight = false }
                                    guard stillVisible else {
                                        call.reject("Only a visible TrackLab activity screen can be shared.", "activity_screen_not_visible")
                                        return
                                    }
                                    guard let encoded = Self.encodeFrame(image),
                                          let cgImage = encoded.image.cgImage else {
                                        call.reject("TrackLab could not encode its app view.", "encode_failed")
                                        return
                                    }

                                    let base64 = encoded.jpeg.base64EncodedString()
                                    call.resolve([
                                        "mimeType": "image/jpeg",
                                        "base64": base64,
                                        "dataUrl": "data:image/jpeg;base64,\(base64)",
                                        "pixelWidth": cgImage.width,
                                        "pixelHeight": cgImage.height,
                                        "capturedAt": Int((Date().timeIntervalSince1970 * 1_000).rounded()),
                                    ])
                                }
                            }
                        }
                    }
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

    private static func visibleRect(for webView: WKWebView) -> CGRect? {
        guard let window = webView.window, !window.isHidden, window.alpha > 0 else { return nil }
        let webViewRectInWindow = webView.convert(webView.bounds, to: window)
        let clippedRectInWindow = webViewRectInWindow.intersection(window.bounds)
        guard !clippedRectInWindow.isNull, !clippedRectInWindow.isEmpty else { return nil }
        let visibleRect = webView.convert(clippedRectInWindow, from: window)
            .intersection(webView.bounds)
        guard visibleRect.width > 0, visibleRect.height > 0 else { return nil }
        return visibleRect
    }

    private static func imageCappedToMaximumEdge(_ image: UIImage) -> UIImage? {
        let sourceWidth = max(1, image.size.width * image.scale)
        let sourceHeight = max(1, image.size.height * image.scale)
        let ratio = min(1, maximumPixelEdge / max(sourceWidth, sourceHeight))
        return imageResized(
            image,
            width: max(1, Int((sourceWidth * ratio).rounded())),
            height: max(1, Int((sourceHeight * ratio).rounded()))
        )
    }

    private static func encodeFrame(_ image: UIImage) -> (image: UIImage, jpeg: Data)? {
        guard var workingImage = imageCappedToMaximumEdge(image) else { return nil }
        // Most app frames fit at the first, highest-quality setting. Highly
        // detailed satellite imagery is progressively compressed and, only
        // if necessary, slightly downscaled so it cannot be rejected by the
        // server's strict 350 KB per-frame transport boundary.
        for resizeAttempt in 0..<5 {
            for quality in jpegQualities {
                if let jpeg = workingImage.jpegData(compressionQuality: quality),
                   jpeg.count <= maximumJpegBytes {
                    return (workingImage, jpeg)
                }
            }
            guard resizeAttempt < 4, let cgImage = workingImage.cgImage else { break }
            let nextWidth = max(320, Int((CGFloat(cgImage.width) * 0.82).rounded()))
            let nextHeight = max(1, Int((CGFloat(cgImage.height) * CGFloat(nextWidth) / CGFloat(cgImage.width)).rounded()))
            guard let resized = imageResized(workingImage, width: nextWidth, height: nextHeight) else { break }
            workingImage = resized
        }
        return nil
    }

    private static func imageResized(_ image: UIImage, width: Int, height: Int) -> UIImage? {
        guard width > 0, height > 0 else { return nil }

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let targetSize = CGSize(width: CGFloat(width), height: CGFloat(height))
        let targetRect = CGRect(origin: .zero, size: targetSize)
        let renderer = UIGraphicsImageRenderer(
            size: targetSize,
            format: format
        )
        return renderer.image { context in
            UIColor.black.setFill()
            context.fill(targetRect)
            image.draw(in: targetRect)
        }
    }
}
