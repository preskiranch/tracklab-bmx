import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Do not create an independent Capacitor web view on a noninteractive
        // external-display scene. With no external-display configuration in the
        // scene manifest, iPadOS mirrors the primary application scene to
        // AirPlay/Apple TV instead.
        guard let windowScene = scene as? UIWindowScene,
              session.role == .windowApplication else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = TrackLabBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
