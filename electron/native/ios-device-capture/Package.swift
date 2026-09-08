// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "IOSDeviceCapture", platforms: [.macOS(.v14)], products: [
    .library(name: "IOSCaptureCore", targets: ["IOSCaptureCore"]),
    .executable(name: "recordly-ios-device-helper", targets: ["IOSDeviceCaptureHelper"])
], targets: [
    .target(name: "IOSCaptureCore"),
    .executableTarget(name: "IOSDeviceCaptureHelper", dependencies: ["IOSCaptureCore"]),
    .testTarget(name: "IOSCaptureCoreTests", dependencies: ["IOSCaptureCore"], resources: [.copy("Fixtures")])
], swiftLanguageModes: [.v5])
