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

  it('selectively clears only delivered TrackLab social remote pushes', () => {
    expect(installation).toContain('CAPPluginMethod(name: "clearDeliveredSocialNotifications"');
    expect(installation).toContain('getDeliveredNotifications');
    expect(installation).toContain('request.trigger is UNPushNotificationTrigger');
    expect(installation).toContain('CFGetTypeID(version) != CFBooleanGetTypeID()');
    expect(installation).toContain('version.intValue == 1');
    expect(installation).toContain('version.doubleValue == 1');
    expect(installation).toContain('info["route"] as? String == "friends"');
    for (const kind of ['live_audio_invite', 'friend_request', 'friend_connection', 'track_share']) {
      expect(installation).toContain(`"${kind}"`);
    }
    expect(installation).toContain('removeDeliveredNotifications(withIdentifiers: identifiers)');
    expect(installation).not.toContain('removeAllDeliveredNotifications');
    expect(installation).toContain('deadline: .now() + 1.0');
  });

  it('enables app push, preserves Watch capability scope, and ships build 20', () => {
    expect(entitlements).toContain('<key>aps-environment</key>');
    expect(project).toContain('com.apple.Push');
    expect(project.match(/CURRENT_PROJECT_VERSION = 20;/gu)).toHaveLength(4);
    expect(project).not.toContain('CURRENT_PROJECT_VERSION = 19;');
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
