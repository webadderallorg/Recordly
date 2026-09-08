import XCTest
@testable import IOSCaptureCore
final class DeviceClassifierTests: XCTestCase {
    func testMuxedIOSScreenDoesNotRequireStandaloneVideoMediaType() {
        // Observed USB screen-device metadata; muxed is the advertised output type.
        XCTAssertTrue(DeviceClassifier.isEligible(.init(modelID: "iOS Device", hasMuxed: true, hasVideo: false)))
    }
    func testPositiveSignatureRequiresKnownModelAndMuxedMedia() {
        XCTAssertTrue(DeviceClassifier.isEligible(.init(modelID: "iOS Device", hasMuxed: true, hasVideo: true)))
        for facts in [DeviceFacts(modelID: "iOS Device", hasMuxed: false, hasVideo: true), .init(modelID: "Webcam", hasMuxed: true, hasVideo: true), .init(modelID: "Continuity Camera", hasMuxed: false, hasVideo: true), .init(modelID: "iPhone18,1", hasMuxed: false, hasVideo: true)] { XCTAssertFalse(DeviceClassifier.isEligible(facts)) }
    }
    func testStableDistinctTokensAndRemovalInvalidation() {
        var inventory = TokenInventory()
        let a = inventory.reconcile(["native-a", "native-b"])
        XCTAssertNotEqual(a["native-a"], a["native-b"])
        XCTAssertEqual(inventory.reconcile(["native-a", "native-b"]), a)
        _ = inventory.reconcile(["native-b"])
        XCTAssertNotEqual(inventory.reconcile(["native-a", "native-b"])["native-a"], a["native-a"])
    }
}
