import Capacitor
import UIKit

@objc(ActivityOrientationPlugin)
public final class ActivityOrientationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ActivityOrientationPlugin"
    public let jsName = "TrackLabActivityOrientation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setActivityMode", returnType: CAPPluginReturnPromise),
    ]

    weak var orientationController: TrackLabBridgeViewController?

    @objc public func setActivityMode(_ call: CAPPluginCall) {
        let active = call.getBool("active") ?? false
        DispatchQueue.main.async { [weak self] in
            self?.orientationController?.setActivityLandscapeRequired(active)
            call.resolve(["active": active])
        }
    }
}

/// Registers TrackLab's app-owned native plugins without modifying Capacitor's
/// generated Swift Package plugin list.
final class TrackLabBridgeViewController: CAPBridgeViewController {
    private var activityLandscapeRequired = false

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        if UIDevice.current.userInterfaceIdiom == .phone && activityLandscapeRequired {
            return .landscape
        }
        return UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown
    }

    override var shouldAutorotate: Bool { true }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(HeartRatePlugin())
        bridge?.registerPluginInstance(RecoveryAlertPlugin())
        bridge?.registerPluginInstance(PushInstallationPlugin())
        bridge?.registerPluginInstance(StoreKitPlugin())
        bridge?.registerPluginInstance(NativeSessionPlugin())
        let activityOrientationPlugin = ActivityOrientationPlugin()
        activityOrientationPlugin.orientationController = self
        bridge?.registerPluginInstance(activityOrientationPlugin)
    }

    func setActivityLandscapeRequired(_ required: Bool) {
        guard UIDevice.current.userInterfaceIdiom == .phone else { return }
        activityLandscapeRequired = required

        if #available(iOS 16.0, *) {
            setNeedsUpdateOfSupportedInterfaceOrientations()
            guard required, let windowScene = view.window?.windowScene else { return }
            let preferences = UIWindowScene.GeometryPreferences.iOS(
                interfaceOrientations: .landscape
            )
            windowScene.requestGeometryUpdate(preferences) { error in
                NSLog("TrackLab could not request iPhone activity landscape: \(error)")
            }
        } else {
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }
}
