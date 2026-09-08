import AVFoundation
import CoreMedia
public struct CaptureClock {
    private let source: CMClock
    public init(session: AVCaptureSession) throws {
        guard let clock = session.synchronizationClock else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
        try self.init(source: clock)
    }
    public init(source: CMClock) throws {
        let rate = CMSyncGetRelativeRate(source, relativeTo: CMClockGetHostTimeClock())
        guard rate.isFinite, abs(rate - 1) < 0.000001 else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
        self.source = source
    }
    public func toHost(_ time: CMTime) throws -> CMTime {
        let value = CMSyncConvertTime(time, from: source, to: CMClockGetHostTimeClock())
        guard value.isNumeric else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
        return value
    }
    public func map(_ sample: CMSampleBuffer) throws -> CMSampleBuffer {
        try Self.retime(sample, converting: toHost)
    }
    public static func retime(_ sample: CMSampleBuffer, converting convert: (CMTime) throws -> CMTime) throws -> CMSampleBuffer {
        var count = 0
        guard CMSampleBufferGetSampleTimingInfoArray(sample, entryCount: 0, arrayToFill: nil, entriesNeededOut: &count) == noErr, count > 0, count <= 65536 else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
        var timing = Array(repeating: CMSampleTimingInfo(), count: count)
        guard CMSampleBufferGetSampleTimingInfoArray(sample, entryCount: count, arrayToFill: &timing, entriesNeededOut: &count) == noErr else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
        for index in timing.indices {
            let sourcePTS = timing[index].presentationTimeStamp
            let hostPTS = try convert(sourcePTS)
            if timing[index].duration.isNumeric {
                let hostEnd = try convert(CMTimeAdd(sourcePTS, timing[index].duration))
                timing[index].duration = CMTimeSubtract(hostEnd, hostPTS)
                guard timing[index].duration >= .zero else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
            }
            timing[index].presentationTimeStamp = hostPTS
            if timing[index].decodeTimeStamp.isNumeric { timing[index].decodeTimeStamp = try convert(timing[index].decodeTimeStamp) }
        }
        var output: CMSampleBuffer?
        guard CMSampleBufferCreateCopyWithNewTiming(allocator: kCFAllocatorDefault, sampleBuffer: sample, sampleTimingEntryCount: count, sampleTimingArray: &timing, sampleBufferOut: &output) == noErr, let output else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
        return output
    }
    public static func offset(firstHostTime: CMTime, videoStartHostTime: CMTime) -> CMTime { CMTimeSubtract(firstHostTime, videoStartHostTime) }
    public static var now: CMTime { CMClockGetTime(CMClockGetHostTimeClock()) }
}
