import XCTest
@testable import IOSCaptureCore
final class PreviewEncoderTests: XCTestCase {
    func testExactBigEndianHeader() throws {
        let record = try PreviewFraming.record(jpeg: Data([0xff, 0xd8]), generation: 0x01020304, sequence: 5)
        XCTAssertEqual(Array(record.prefix(24)), [82,76,73,80,0,1,0,0,1,2,3,4,0,0,0,5,0,0,0,2,0,0,0,0])
        XCTAssertEqual(record.count, 26)
    }
    func testRejectOversizedPreview() { XCTAssertThrowsError(try PreviewFraming.record(jpeg: Data(repeating: 0, count: 131073), generation: 1, sequence: 1)) }
}
