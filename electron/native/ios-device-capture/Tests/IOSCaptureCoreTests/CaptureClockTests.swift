import XCTest
import CoreMedia
@testable import IOSCaptureCore
final class CaptureClockTests: XCTestCase {
    func testOffsetsPreserveDelayedAndEarlyAudio() {
        let start = CMTime(value: 100000, timescale: 1000)
        XCTAssertEqual(CaptureClock.offset(firstHostTime: CMTime(value: 100250, timescale: 1000), videoStartHostTime: start).seconds, 0.25, accuracy: 0.000001)
        XCTAssertEqual(CaptureClock.offset(firstHostTime: CMTime(value: 99880, timescale: 1000), videoStartHostTime: start).seconds, -0.12, accuracy: 0.000001)
        XCTAssertEqual(CaptureClock.offset(firstHostTime: CMTime(value: 6015, timescale: 60), videoStartHostTime: start).seconds, 0.25, accuracy: 0.000001)
    }
    func testRationalSerializationAndInvalidTime() throws {
        let value = try NativeTime(CMTime(value: 9007199254740993, timescale: 1000000000))
        XCTAssertEqual(value.value, "9007199254740993")
        XCTAssertThrowsError(try NativeTime(.invalid))
    }
    func testRealHostClockRoundTrip() throws {
        let clock = try CaptureClock(source: CMClockGetHostTimeClock())
        let original = CaptureClock.now
        XCTAssertEqual(CMTimeCompare(try clock.toHost(original), original), 0)
    }
}

func slightlyFastSourceTimebase() throws -> CMTimebase {
    var source: CMTimebase?
    XCTAssertEqual(CMTimebaseCreateWithSourceClock(allocator: kCFAllocatorDefault, sourceClock: CMClockGetHostTimeClock(), timebaseOut: &source), noErr)
    let timebase = try XCTUnwrap(source)
    let anchor = CMTime(value: 100_000_000_000, timescale: 1_000_000_000)
    XCTAssertEqual(CMTimebaseSetRateAndAnchorTime(timebase, rate: 1.0000005, anchorTime: anchor, immediateSourceTime: anchor), noErr)
    return timebase
}
extension CaptureClockTests {
    func testRateConversionMapsDurationAlongWithPTSAndDTS() throws {
        let source = try slightlyFastSourceTimebase()
        let sample = try syntheticAudioSample(at: 100)
        let mapped = try CaptureClock.retime(sample) { CMSyncConvertTime($0, from: source, to: CMClockGetHostTimeClock()) }
        let first = CMSampleBufferGetPresentationTimeStamp(mapped)
        let end = CMSyncConvertTime(CMTime(value: 100_010_000_000, timescale: 1_000_000_000), from: source, to: CMClockGetHostTimeClock())
        XCTAssertLessThan(CMSampleBufferGetDuration(mapped).seconds, 0.01)
        XCTAssertEqual(CMTimeAdd(first, CMSampleBufferGetDuration(mapped)).seconds, end.seconds, accuracy: 0.000001)
    }
}
