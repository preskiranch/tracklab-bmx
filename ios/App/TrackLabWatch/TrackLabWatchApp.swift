import HealthKit
import SwiftUI
import WatchKit

@main
struct TrackLabWatchApp: App {
    @WKApplicationDelegateAdaptor(TrackLabWatchAppDelegate.self) private var appDelegate
    @StateObject private var workout = WatchWorkoutManager.shared

    var body: some Scene {
        WindowGroup {
            WatchWorkoutView()
                .environmentObject(workout)
        }
    }
}

final class TrackLabWatchAppDelegate: NSObject, WKApplicationDelegate {
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        WatchWorkoutManager.shared.start(with: workoutConfiguration)
    }

    func handleActiveWorkoutRecovery() {
        WatchWorkoutManager.shared.recoverActiveWorkout()
    }
}
