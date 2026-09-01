import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSourceDirectories = [
  new URL('../../ios/App/App/', import.meta.url),
  new URL('../../ios/App/Shared/', import.meta.url),
];
const appSources = appSourceDirectories.flatMap((directory) => (
  readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.swift'))
    .map((fileName) => ({
      fileName,
      source: readFileSync(new URL(fileName, directory), 'utf8'),
    }))
));
const appPrivacyManifest = readFileSync(
  new URL('../../ios/App/App/PrivacyInfo.xcprivacy', import.meta.url),
  'utf8',
);
const watchPrivacyManifest = readFileSync(
  new URL('../../ios/App/TrackLabWatch/PrivacyInfo.xcprivacy', import.meta.url),
  'utf8',
);
const xcodeProject = readFileSync(
  new URL('../../ios/App/App.xcodeproj/project.pbxproj', import.meta.url),
  'utf8',
);

const requiredReasonPatterns = new Map([
  [
    'NSPrivacyAccessedAPICategoryUserDefaults',
    /\bUserDefaults(?:\.standard|\s*\()/,
  ],
  [
    'NSPrivacyAccessedAPICategoryFileTimestamp',
    /\b(?:NSFileCreationDate|NSFileModificationDate|creationDateKey|contentModificationDateKey|attributesOfItem\s*\()/,
  ],
  [
    'NSPrivacyAccessedAPICategorySystemBootTime',
    /\b(?:systemUptime|mach_absolute_time|mach_continuous_time)\b/,
  ],
  [
    'NSPrivacyAccessedAPICategoryDiskSpace',
    /\b(?:volumeAvailableCapacityKey|volumeAvailableCapacityForImportantUsageKey|volumeAvailableCapacityForOpportunisticUsageKey|systemFreeSize|systemSize|statfs\s*\()/,
  ],
]);

function declaredRequiredReasonCategories(manifest: string) {
  return [...manifest.matchAll(
    /<string>(NSPrivacyAccessedAPICategory[^<]+)<\/string>/g,
  )].map((match) => match[1]);
}

describe('iOS required-reason API declarations', () => {
  it('covers every required-reason API category used by the iOS App sources', () => {
    const usedCategories = [...requiredReasonPatterns.entries()]
      .filter(([, pattern]) => appSources.some(({ source }) => pattern.test(source)))
      .map(([category]) => category);

    expect(usedCategories).toEqual(['NSPrivacyAccessedAPICategoryUserDefaults']);
    expect(declaredRequiredReasonCategories(appPrivacyManifest)).toEqual(usedCategories);
  });

  it('declares CA92.1 for app-owned standard defaults in both executables', () => {
    const recoveryManager = appSources.find(
      ({ fileName }) => fileName === 'RecoveryAlertManager.swift',
    )?.source;
    expect(recoveryManager).toContain('UserDefaults.standard');

    for (const manifest of [appPrivacyManifest, watchPrivacyManifest]) {
      expect(manifest).toMatch(
        /<string>NSPrivacyAccessedAPICategoryUserDefaults<\/string>[\s\S]*?<string>CA92\.1<\/string>/,
      );
    }
  });

  it('keeps iOS and embedded Watch Debug and Release builds on build 36', () => {
    const buildNumbers = [...xcodeProject.matchAll(
      /CURRENT_PROJECT_VERSION = (\d+);/g,
    )].map((match) => match[1]);
    expect(buildNumbers).toEqual(['36', '36', '36', '36']);
  });

  it('declares every linked account, training, social, route, purchase, and diagnostic type without tracking', () => {
    for (const dataType of [
      'NSPrivacyCollectedDataTypeHealth',
      'NSPrivacyCollectedDataTypeFitness',
      'NSPrivacyCollectedDataTypePurchaseHistory',
      'NSPrivacyCollectedDataTypeUserID',
      'NSPrivacyCollectedDataTypeName',
      'NSPrivacyCollectedDataTypeEmailAddress',
      'NSPrivacyCollectedDataTypePhysicalAddress',
      'NSPrivacyCollectedDataTypeContacts',
      'NSPrivacyCollectedDataTypeEmailsOrTextMessages',
      'NSPrivacyCollectedDataTypePhotosorVideos',
      'NSPrivacyCollectedDataTypePreciseLocation',
      'NSPrivacyCollectedDataTypeGameplayContent',
      'NSPrivacyCollectedDataTypeOtherUserContent',
      'NSPrivacyCollectedDataTypeSearchHistory',
      'NSPrivacyCollectedDataTypeDeviceID',
      'NSPrivacyCollectedDataTypeProductInteraction',
      'NSPrivacyCollectedDataTypeOtherDiagnosticData',
    ]) {
      expect(appPrivacyManifest).toMatch(new RegExp(
        `<string>${dataType}</string>[\\s\\S]*?`
          + '<key>NSPrivacyCollectedDataTypeLinked</key>\\s*<true\\/>[\\s\\S]*?'
          + '<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>[\\s\\S]*?'
          + '<key>NSPrivacyCollectedDataTypeTracking</key>\\s*<false\\/>',
      ));
    }
    expect(appPrivacyManifest).toContain('NSPrivacyCollectedDataTypePurposeAnalytics');
    expect(appPrivacyManifest).toMatch(
      /<key>NSPrivacyTracking<\/key>\s*<false\/>/,
    );
  });
});
