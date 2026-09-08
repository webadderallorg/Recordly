import Foundation
import AVFoundation
import CoreMedia

public final class AudioWriter {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let description: CMFormatDescription
    public let sampleRate: Double
    public let channels: Int
    public private(set) var firstHostTime: CMTime
    public private(set) var endHostTime: CMTime
    public private(set) var sampleCount = 0
    public private(set) var gaps: [[String: Any]] = []
    public init(url: URL, firstSample: CMSampleBuffer) throws {
        guard let description = CMSampleBufferGetFormatDescription(firstSample), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee,
              asbd.mFormatID == kAudioFormatLinearPCM, asbd.mBitsPerChannel == 16, asbd.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0, asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0, asbd.mSampleRate > 0, asbd.mChannelsPerFrame > 0, asbd.mChannelsPerFrame <= 2 else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        self.description = description; sampleRate = asbd.mSampleRate; channels = Int(asbd.mChannelsPerFrame)
        firstHostTime = CMSampleBufferGetPresentationTimeStamp(firstSample); endHostTime = firstHostTime
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        writer.movieFragmentInterval = CMTime(value: 10, timescale: 1); writer.initialMovieFragmentInterval = CMTime(value: 1, timescale: 1)
        input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: description)
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw CaptureFailure("UNSUPPORTED_FORMAT") }; writer.add(input)
        guard writer.startWriting() else { throw CaptureFailure("WRITER_FAILED") }
        writer.startSession(atSourceTime: firstHostTime)
    }
    public func append(_ sample: CMSampleBuffer) throws {
        guard let format = CMSampleBufferGetFormatDescription(sample), CMFormatDescriptionEqual(description, otherFormatDescription: format) else { throw CaptureFailure("FORMAT_CHANGED") }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        let duration = CMSampleBufferGetDuration(sample)
        guard pts.isNumeric, duration.isNumeric, duration > .zero, CMTimeSubtract(endHostTime, pts).seconds <= 1 / sampleRate else { throw CaptureFailure("AUDIO_INTERRUPTED") }
        if CMTimeSubtract(pts, endHostTime).seconds > 1 / sampleRate {
            guard gaps.count < 128 else { throw CaptureFailure("AUDIO_INTERRUPTED") }
            try appendSilence(until: pts)
            gaps.append(["start": try jsonObject(NativeTime(CMTimeSubtract(endHostTime, firstHostTime))), "duration": try jsonObject(NativeTime(CMTimeSubtract(pts, endHostTime))), "representedInMedia": true])
        }
        guard writer.status == .writing, input.isReadyForMoreMediaData, input.append(sample) else { throw CaptureFailure("WRITER_FAILED") }
        endHostTime = CMTimeAdd(pts, duration); sampleCount += CMSampleBufferGetNumSamples(sample)
    }
    private func appendSilence(until stop: CMTime) throws {
        let frames = Int((CMTimeSubtract(stop, endHostTime).seconds * sampleRate).rounded())
        guard frames > 0, frames <= Int(sampleRate) else { throw CaptureFailure("AUDIO_INTERRUPTED") }
        let bytes = frames * channels * 2
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes, blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: 0, blockBufferOut: &block) == noErr, let block,
              CMBlockBufferFillDataBytes(with: 0, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes) == noErr else { throw CaptureFailure("WRITER_FAILED") }
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: Int32(sampleRate)), presentationTimeStamp: endHostTime, decodeTimeStamp: .invalid)
        var size = channels * 2
        var silence: CMSampleBuffer?
        guard CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: description, sampleCount: frames, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &silence) == noErr, let silence, input.isReadyForMoreMediaData, input.append(silence) else { throw CaptureFailure("WRITER_FAILED") }
    }
    public func finish(completion: @escaping (Result<Void, Error>) -> Void) {
        input.markAsFinished()
        writer.finishWriting { [writer] in completion(writer.status == .completed && self.sampleCount > 0 ? .success(()) : .failure(CaptureFailure("FINALIZATION_FAILED"))) }
    }
}
