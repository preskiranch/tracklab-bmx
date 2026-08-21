import SwiftUI

struct WatchWorkoutView: View {
    @EnvironmentObject private var workout: WatchWorkoutManager

    var body: some View {
        VStack(spacing: 10) {
            Text("Watch Connect")
                .font(.headline)

            if let bpm = workout.heartRateBpm {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Image(systemName: "heart.fill")
                        .foregroundStyle(.red)
                    Text("\(Int(bpm.rounded()))")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                    Text("BPM")
                        .font(.caption2)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Heart rate \(Int(bpm.rounded())) beats per minute")
            } else {
                HStack(spacing: 5) {
                    Image(systemName: "heart")
                    Text(workout.state == .idle ? "Ready" : "Waiting for heart rate")
                        .font(.caption)
                }
            }

            Text(workout.message)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(3)

            controls
        }
        .padding(.horizontal, 8)
    }

    @ViewBuilder
    private var controls: some View {
        switch workout.state {
        case .idle, .ended, .error:
            Label("Press Watch Connect on iPhone", systemImage: "iphone")
                .font(.caption2)
                .multilineTextAlignment(.center)
        case .active:
            HStack {
                Button {
                    workout.pause()
                } label: {
                    Image(systemName: "pause.fill")
                }
                .accessibilityLabel("Pause workout")

                Button(role: .destructive) {
                    workout.end()
                } label: {
                    Image(systemName: "stop.fill")
                }
                .accessibilityLabel("End and save workout")
            }
        case .paused:
            HStack {
                Button {
                    workout.resume()
                } label: {
                    Image(systemName: "play.fill")
                }
                .tint(.green)
                .accessibilityLabel("Resume workout")

                Button(role: .destructive) {
                    workout.end()
                } label: {
                    Image(systemName: "stop.fill")
                }
                .accessibilityLabel("End and save workout")
            }
        case .authorizing, .connecting, .ending:
            ProgressView()
        }
    }
}

#Preview {
    WatchWorkoutView()
        .environmentObject(WatchWorkoutManager.shared)
}
