import Capacitor

/// Registers TrackLab's app-owned native plugins without modifying Capacitor's
/// generated Swift Package plugin list.
final class TrackLabBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(HeartRatePlugin())
        bridge?.registerPluginInstance(RecoveryAlertPlugin())
        bridge?.registerPluginInstance(PushInstallationPlugin())
    }
}
