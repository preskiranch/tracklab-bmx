import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CAPACITOR_VERSION = '8.5.0'
const CAPACITOR_REPOSITORY = 'https://github.com/ionic-team/capacitor-swift-pm.git'
const ARTIFACTS = [
  {
    name: 'Capacitor',
    checksum: '357220fe6dad73cb78bc1dc83e16e89d59c3d7dac8f9b17545a5be64bba25130',
  },
  {
    name: 'Cordova',
    checksum: 'a3dc72b5a559948d548f0ee2926b989492acc1023a0c86a1bf85477587f83a10',
  },
]

const projectRoot = process.cwd()
const manifestPaths = [
  path.join(projectRoot, 'ios/App/CapApp-SPM/Package.swift'),
  path.join(projectRoot, 'node_modules/@capacitor/app/Package.swift'),
  path.join(projectRoot, 'node_modules/@capacitor/push-notifications/Package.swift'),
  path.join(projectRoot, 'node_modules/@capacitor-community/bluetooth-le/Package.swift'),
]
const workspaceResolvedPath = path.join(
  projectRoot,
  'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
)
const cacheRoot = path.join(os.tmpdir(), `tracklab-capacitor-swift-pm-${CAPACITOR_VERSION}`)
const localPackagePath = path.join(cacheRoot, 'package')
const binariesPath = path.join(localPackagePath, 'Binaries')
const derivedDataPath = process.env.TRACKLAB_IOS_DERIVED_DATA
  || path.join(os.tmpdir(), 'tracklab-ios-derived')
const sdk = process.env.TRACKLAB_IOS_SDK || 'iphoneos'
if (sdk !== 'iphoneos' && sdk !== 'iphonesimulator') {
  throw new Error('TRACKLAB_IOS_SDK must be iphoneos or iphonesimulator')
}
const destination = sdk === 'iphoneos'
  ? 'generic/platform=iOS'
  : 'generic/platform=iOS Simulator'

function resolveDeveloperDirectory() {
  if (process.env.DEVELOPER_DIR) {
    return process.env.DEVELOPER_DIR
  }

  const isFullXcodeDeveloperDirectory = (candidate) => (
    Boolean(candidate)
    && fs.existsSync(path.join(candidate, 'usr/bin/xcodebuild'))
    && fs.existsSync(path.join(candidate, 'Platforms/iPhoneOS.platform'))
    && fs.existsSync(path.join(candidate, 'Platforms/iPhoneSimulator.platform'))
  )

  const result = spawnSync('/usr/bin/xcode-select', ['-p'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const selectedPath = result.stdout?.trim()
  if (
    result.status === 0
    && isFullXcodeDeveloperDirectory(selectedPath)
  ) {
    return selectedPath
  }

  const standardXcodePath = '/Applications/Xcode.app/Contents/Developer'
  if (isFullXcodeDeveloperDirectory(standardXcodePath)) {
    return standardXcodePath
  }

  throw new Error(
    'Unable to locate the full Xcode application. Install Xcode or set DEVELOPER_DIR to its Contents/Developer directory.',
  )
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
  }
}

function checksum(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function binaryArtifactIsValid(name, frameworkPath) {
  const binaryPath = path.join(
    frameworkPath,
    'ios-arm64',
    `${name}.framework`,
    name,
  )
  return fs.existsSync(path.join(frameworkPath, 'Info.plist'))
    && fs.existsSync(binaryPath)
    && fs.statSync(binaryPath).size > 0
}

function prepareArtifact({ name, checksum: expectedChecksum }) {
  const archivePath = path.join(cacheRoot, `${name}.xcframework.zip`)
  const frameworkPath = path.join(binariesPath, `${name}.xcframework`)
  const url = `https://github.com/ionic-team/capacitor-swift-pm/releases/download/${CAPACITOR_VERSION}/${name}.xcframework.zip`

  if (!fs.existsSync(archivePath) || checksum(archivePath) !== expectedChecksum) {
    fs.mkdirSync(cacheRoot, { recursive: true })
    const temporaryPath = `${archivePath}.download`
    fs.rmSync(temporaryPath, { force: true })
    run('/usr/bin/curl', [
      '--fail',
      '--location',
      '--retry',
      '3',
      '--output',
      temporaryPath,
      url,
    ])

    const actualChecksum = checksum(temporaryPath)
    if (actualChecksum !== expectedChecksum) {
      fs.rmSync(temporaryPath, { force: true })
      throw new Error(`${name} checksum mismatch: expected ${expectedChecksum}, received ${actualChecksum}`)
    }
    fs.renameSync(temporaryPath, archivePath)
  }

  if (!binaryArtifactIsValid(name, frameworkPath)) {
    fs.rmSync(frameworkPath, { force: true, recursive: true })
    fs.mkdirSync(binariesPath, { recursive: true })
    run('/usr/bin/ditto', ['-x', '-k', archivePath, binariesPath])
    if (!binaryArtifactIsValid(name, frameworkPath)) {
      throw new Error(`${name} binary artifact could not be extracted`)
    }
  }
}

function writeLocalPackage() {
  fs.mkdirSync(localPackagePath, { recursive: true })
  fs.writeFileSync(path.join(localPackagePath, 'Package.swift'), `// swift-tools-version:5.9

import PackageDescription

let package = Package(
    name: "TrackLabCapacitorBinaries",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "Capacitor", targets: ["Capacitor"]),
        .library(name: "Cordova", targets: ["Cordova"]),
    ],
    targets: [
        .binaryTarget(name: "Capacitor", path: "Binaries/Capacitor.xcframework"),
        .binaryTarget(name: "Cordova", path: "Binaries/Cordova.xcframework"),
    ]
)
`)
}

function localizeManagedPackage(source) {
  const escapedRepository = CAPACITOR_REPOSITORY.replaceAll('.', '\\.').replaceAll('/', '\\/')
  const remoteDependency = new RegExp(`\\.package\\(url: "${escapedRepository}", (?:exact|from): "[^"]+"\\)`)
  if (!remoteDependency.test(source)) {
    throw new Error('Capacitor package layout changed; refusing to patch a Package.swift manifest')
  }

  const escapedPath = localPackagePath.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return source
    .replace(remoteDependency, `.package(name: "TrackLabCapacitorBinaries", path: "${escapedPath}")`)
    .replaceAll('package: "capacitor-swift-pm"', 'package: "TrackLabCapacitorBinaries"')
}

for (const artifact of ARTIFACTS) {
  prepareArtifact(artifact)
}
writeLocalPackage()

const originalManifests = new Map()
const originalWorkspaceResolved = fs.existsSync(workspaceResolvedPath)
  ? fs.readFileSync(workspaceResolvedPath)
  : null

try {
  for (const manifestPath of manifestPaths) {
    const source = fs.readFileSync(manifestPath, 'utf8')
    originalManifests.set(manifestPath, source)
    fs.writeFileSync(manifestPath, localizeManagedPackage(source))
  }

  run('/usr/bin/xcodebuild', [
    '-project',
    'ios/App/App.xcodeproj',
    '-scheme',
    'App',
    '-sdk',
    sdk,
    '-destination',
    destination,
    '-derivedDataPath',
    derivedDataPath,
    'CODE_SIGNING_ALLOWED=NO',
    'build',
  ], {
    env: {
      ...process.env,
      DEVELOPER_DIR: resolveDeveloperDirectory(),
      CLANG_MODULE_CACHE_PATH: path.join(os.tmpdir(), 'tracklab-clang-cache'),
      SWIFTPM_MODULECACHE_OVERRIDE: path.join(os.tmpdir(), 'tracklab-swift-cache'),
    },
  })
} finally {
  for (const [manifestPath, source] of originalManifests) {
    fs.writeFileSync(manifestPath, source)
  }
  if (originalWorkspaceResolved) {
    fs.mkdirSync(path.dirname(workspaceResolvedPath), { recursive: true })
    fs.writeFileSync(workspaceResolvedPath, originalWorkspaceResolved)
  } else {
    fs.rmSync(workspaceResolvedPath, { force: true })
  }
}
