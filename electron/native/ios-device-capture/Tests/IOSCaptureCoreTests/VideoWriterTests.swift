import XCTest
import CoreMedia
@testable import IOSCaptureCore
final class VideoWriterTests: XCTestCase {
    func testBoundaryWaitsForSyncSample() {
        var policy = VideoBoundary(boundary: CMTime(value: 10, timescale: 1))
        XCTAssertFalse(policy.accept(pts: CMTime(value: 9, timescale: 1), isSync: true))
        XCTAssertFalse(policy.accept(pts: CMTime(value: 11, timescale: 1), isSync: false))
        XCTAssertTrue(policy.accept(pts: CMTime(value: 12, timescale: 1), isSync: true))
        XCTAssertTrue(policy.accept(pts: CMTime(value: 13, timescale: 1), isSync: false))
        XCTAssertTrue(policy.accept(pts: CMTime(value: 12, timescale: 1), isSync: false))
    }
    func testQualityPolicyAndOddDimensions() {
        XCTAssertEqual(VideoFormatPolicy.bitrate(width: 1170, height: 2532, fps: 30), 12000000)
        XCTAssertThrowsError(try VideoFormatPolicy.validateGeometry(width: 1171, height: 2533))
    }
}
