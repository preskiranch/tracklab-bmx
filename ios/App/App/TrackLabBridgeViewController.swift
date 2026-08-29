import Capacitor
import UIKit

/// Registers TrackLab's app-owned native plugins without modifying Capacitor's
/// generated Swift Package plugin list.
final class TrackLabBridgeViewController: CAPBridgeViewController {
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown
    }

    override var shouldAutorotate: Bool { true }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.scrollView.alwaysBounceHorizontal = false
        webView?.scrollView.showsHorizontalScrollIndicator = false
        webView?.scrollView.isDirectionalLockEnabled = true
        bridge?.registerPluginInstance(HeartRatePlugin())
        bridge?.registerPluginInstance(RecoveryAlertPlugin())
        bridge?.registerPluginInstance(PushInstallationPlugin())
        bridge?.registerPluginInstance(StoreKitPlugin())
        bridge?.registerPluginInstance(NativeSessionPlugin())
    }
}
