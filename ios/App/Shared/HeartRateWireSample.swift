import Foundation

/// Versioned payload sent from the primary workout session on Apple Watch to
/// the mirrored session on iPhone. The web layer receives the same field names.
struct HeartRateWireSample: Codable {
    static let currentVersion = 1

    let version: Int
    let sessionId: String?
    let sequence: Int
    let bpm: Double
    let measuredAt: Double
    let source: String

    init(
        sessionId: String?,
        sequence: Int,
        bpm: Double,
        measuredAt: Date,
        source: String = "apple-watch"
    ) {
        self.version = Self.currentVersion
        self.sessionId = sessionId
        self.sequence = sequence
        self.bpm = bpm
        self.measuredAt = measuredAt.timeIntervalSince1970 * 1_000
        self.source = source
    }
}
