import XCTest
import AVFoundation
@testable import IOSCaptureCore
func syntheticAudioSample(at seconds: Double) throws -> CMSampleBuffer {
    var asbd = AudioStreamBasicDescription(mSampleRate: 48000, mFormatID: kAudioFormatLinearPCM, mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked, mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
    var description: CMAudioFormatDescription?
    XCTAssertEqual(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &description), noErr)
    var block: CMBlockBuffer?
    XCTAssertEqual(CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: 960, blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0, dataLength: 960, flags: 0, blockBufferOut: &block), noErr)
    XCTAssertEqual(CMBlockBufferFillDataBytes(with: 0, blockBuffer: block!, offsetIntoDestination: 0, dataLength: 960), noErr)
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000), presentationTimeStamp: CMTime(seconds: seconds, preferredTimescale: 48000), decodeTimeStamp: .invalid)
    var size = 2
    var sample: CMSampleBuffer?
    XCTAssertEqual(CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: description, sampleCount: 480, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample), noErr)
    return try XCTUnwrap(sample)
}
final class AudioWriterTests: XCTestCase {
    func testPCMOffsetSilenceAndInternalGapSurviveMovie() async throws {
        let first = try syntheticAudioSample(at: 100.25)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try AudioWriter(url: url, firstSample: first)
        try writer.append(first)
        try writer.append(syntheticAudioSample(at: 100.29))
        XCTAssertEqual(writer.firstHostTime.seconds, 100.25, accuracy: 0.000001)
        XCTAssertEqual(writer.gaps.count, 1)
        XCTAssertEqual(writer.sampleCount, 960)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in writer.finish { continuation.resume(with: $0) } }
        let result = try await MediaInspector.inspect(url: url)
        XCTAssertEqual(result["decodable"] as? Bool, true)
        let duration = result["duration"] as! [String: Any]
        XCTAssertEqual(Double(duration["value"] as! String)! / Double(duration["timescale"] as! Int32), 0.05, accuracy: 0.001)
    }
    func testBackwardAudioTimestampFailsInsteadOfFlattening() throws {
        let first = try syntheticAudioSample(at: 100)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try AudioWriter(url: url, firstSample: first)
        try writer.append(first)
        XCTAssertThrowsError(try writer.append(syntheticAudioSample(at: 99)))
    }
}

extension AudioWriterTests {
    func testAcceptedClockRateDoesNotTurnContiguousPCMIntoAnInterruption() async throws {
        let source = try slightlyFastSourceTimebase()
        let convert: (CMTime) -> CMTime = { CMSyncConvertTime($0, from: source, to: CMClockGetHostTimeClock()) }
        let first = try CaptureClock.retime(syntheticAudioSample(at: 100), converting: convert)
        let next = try CaptureClock.retime(syntheticAudioSample(at: 100.01), converting: convert)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try AudioWriter(url: url, firstSample: first)
        try writer.append(first)
        XCTAssertNoThrow(try writer.append(next))
        XCTAssertEqual(writer.sampleCount, 960)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in writer.finish { continuation.resume(with: $0) } }
    }
}
