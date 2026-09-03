import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('native iOS push integration', () => {
  const appDelegate = read('../../ios/App/App/AppDelegate.swift');
  const installation = read('../../ios/App/App/PushInstallationPlugin.swift');
  const bridge = read('../../ios/App/App/TrackLabBridgeViewController.swift');
  const recoveryManager = read('../../ios/App/App/RecoveryAlertManager.swift');
  const recoveryPlugin = read('../../ios/App/App/RecoveryAlertPlugin.swift');
  const entitlements = read('../../ios/App/App/App.entitlements');
  const project = read('../../ios/App/App.xcodeproj/project.pbxproj');
  const config = read('../../capacitor.config.ts');
  const offlinePage = read('../../public/offline.html');
  const unsignedBuild = read('../../scripts/build-ios-unsigned.mjs');

  it('uses the official Capacitor push callbacks and one notification router', () => {
    expect(appDelegate).toContain('.capacitorDidRegisterForRemoteNotifications');
    expect(appDelegate).toContain('.capacitorDidFailToRegisterForRemoteNotifications');
    expect(recoveryManager).not.toContain('center.delegate = self');
    expect(recoveryManager).not.toContain('UNUserNotificationCenterDelegate');
    expect(recoveryPlugin).toContain('NotificationHandlerProtocol');
    expect(recoveryPlugin).toContain('notificationRouter.localNotificationHandler = notificationHandler');
    expect(recoveryPlugin).not.toContain('pushNotificationHandler');
    expect(config).toMatch(/PushNotifications:\s*\{[\s\S]*presentationOptions: \['sound'\]/u);
  });

  it('keeps the installation identity and credential in device-only Keychain storage', () => {
    expect(installation).toContain('kSecClassGenericPassword');
    expect(installation).toContain('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly');
    expect(installation).toContain('SecRandomCopyBytes');
    expect(installation).toContain('count: 32');
    expect(installation).toContain('UUID().uuidString.lowercased()');
    expect(installation).toContain('TrackLabAPNsEnvironment');
    expect(installation).not.toContain('UserDefaults');
    expect(bridge).toContain('registerPluginInstance(PushInstallationPlugin())');
  });

  it('selectively clears only delivered TrackLab remote pushes bound to the old account', () => {
    expect(installation).toContain('CAPPluginMethod(name: "clearDeliveredSocialNotifications"');
    expect(installation).toContain('getDeliveredNotifications');
    expect(installation).toContain('request.trigger is UNPushNotificationTrigger');
    expect(installation).toContain('CFGetTypeID(version) != CFBooleanGetTypeID()');
    expect(installation).toContain('version.intValue == 1');
    expect(installation).toContain('version.doubleValue == 1');
    expect(installation).toContain('let route = info["route"] as? String');
    expect(installation).toContain('route == "friends" && friendKinds.contains(kind)');
    expect(installation).toContain('route == "recovery" && kind == "recovery_ready"');
    for (const kind of ['live_audio_invite', 'friend_request', 'friend_connection', 'track_share']) {
      expect(installation).toContain(`"${kind}"`);
    }
    expect(installation).toContain('"recovery_ready"');
    expect(installation).toContain('removeDeliveredNotifications(withIdentifiers: identifiers)');
    expect(installation).not.toContain('removeAllDeliveredNotifications');
    expect(installation).toContain('deadline: .now() + 1.0');
  });

  it('enables app push, preserves Watch capability scope, and ships build 54', () => {
    expect(entitlements).toContain('<key>aps-environment</key>');
    expect(project).toContain('com.apple.Push');
    expect(project.match(/CURRENT_PROJECT_VERSION = 54;/gu)).toHaveLength(4);
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 40;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 39;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 38;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 37;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 36;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 35;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 34;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 33;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 30;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 29;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 28;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 26;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 25;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 24;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 23;');
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 21;');
    expect(unsignedBuild).toContain("node_modules/@capacitor/push-notifications/Package.swift");
    expect(unsignedBuild).toContain('binaryArtifactIsValid');
    expect(unsignedBuild).toContain("'ios-arm64'");
    expect(unsignedBuild).toContain('TRACKLAB_IOS_SDK');
    expect(unsignedBuild).toContain('generic/platform=iOS Simulator');
    expect(unsignedBuild).toContain('originalWorkspaceResolved');
  });

  it('ships the audited web bundle and a local outage screen', () => {
    expect(config).toContain("webDir: 'dist'");
    expect(config).not.toMatch(/server\s*:\s*\{/u);
    expect(config).not.toContain("url: 'https://tracklab-bmx.onrender.com'");
    expect(offlinePage).toContain('TrackLab is temporarily offline');
    expect(offlinePage).toContain('window.location.reload()');
    expect(unsignedBuild).toContain("'Platforms/iPhoneOS.platform'");
    expect(unsignedBuild).toContain("'Platforms/iPhoneSimulator.platform'");
  });
});
