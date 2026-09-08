import Foundation
import AVFoundation
import CoreMedia
import CryptoKit
public enum MediaInspector {
    public static func inspect(url: URL) async throws -> [String: Any] {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration)
        guard duration.isNumeric, duration > .zero else { throw CaptureFailure("FINALIZATION_FAILED") }
        let videos = try await asset.loadTracks(withMediaType: .video)
        let audios = try await asset.loadTracks(withMediaType: .audio)
        var result: [String: Any] = ["duration": try jsonObject(NativeTime(duration)), "decodable": false]
        if let video = videos.first {
            let size = try await video.load(.naturalSize)
            let transform = try await video.load(.preferredTransform)
            let descriptions = try await video.load(.formatDescriptions)
            guard size.width > 0, size.height > 0, let description = descriptions.first else { throw CaptureFailure("FINALIZATION_FAILED") }
            let reader = try AVAssetReader(asset: asset)
            let output = AVAssetReaderTrackOutput(track: video, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
            guard reader.canAdd(output) else { throw CaptureFailure("FINALIZATION_FAILED") }; reader.add(output)
            guard reader.startReading(), let first = output.copyNextSampleBuffer(), CMSampleBufferGetImageBuffer(first) != nil else { throw CaptureFailure("FINALIZATION_FAILED") }
            reader.cancelReading()
            result["decodable"] = true
            let coded = CMVideoFormatDescriptionGetDimensions(description)
            let display = CMVideoFormatDescriptionGetPresentationDimensions(description, usePixelAspectRatio: true, useCleanAperture: true)
            let ext = (CMFormatDescriptionGetExtensions(description) ?? [:] as CFDictionary) as NSDictionary
            let codec = CMFormatDescriptionGetMediaSubType(description) == kCMVideoCodecType_H264 ? "h264" : String(format: "%08x", CMFormatDescriptionGetMediaSubType(description))
            let hash = SHA256.hash(data: Data("\(coded.width):\(coded.height):\(codec)".utf8)).map { String(format: "%02x", $0) }.joined()
            result["video"] = try jsonObject(IOSVideoFormat(codedWidth: Int(coded.width), codedHeight: Int(coded.height), displayWidth: display.width, displayHeight: display.height, codec: codec, colorPrimaries: ext[kCMFormatDescriptionExtension_ColorPrimaries] as? String, transferFunction: ext[kCMFormatDescriptionExtension_TransferFunction] as? String, ycbcrMatrix: ext[kCMFormatDescriptionExtension_YCbCrMatrix] as? String, fullRange: ext[kCMFormatDescriptionExtension_FullRangeVideo] as? Bool, transform: [transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty], observedFrameRate: nil, fingerprint: hash))

        }
        if let audio = audios.first, let description = try await audio.load(.formatDescriptions).first, let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee {
            result["audio"] = ["codec": asbd.mFormatID == kAudioFormatLinearPCM ? "pcm" : String(format: "%08x", asbd.mFormatID), "sampleRate": asbd.mSampleRate, "channels": Int(asbd.mChannelsPerFrame)]
            if videos.isEmpty {
                let reader = try AVAssetReader(asset: asset)
                let output = AVAssetReaderTrackOutput(track: audio, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
                guard reader.canAdd(output) else { throw CaptureFailure("FINALIZATION_FAILED") }; reader.add(output)
                guard reader.startReading(), output.copyNextSampleBuffer() != nil else { throw CaptureFailure("FINALIZATION_FAILED") }
                reader.cancelReading(); result["decodable"] = true
            }
        }
        return result
    }
}

import VideoToolbox
extension MediaInspector {
    public static func validateFirstSample(_ sample: CMSampleBuffer) throws {
        if CMSampleBufferGetImageBuffer(sample) != nil { return }
        guard let description = CMSampleBufferGetFormatDescription(sample), VideoFormatPolicy.isSync(sample) else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        var decoder: VTDecompressionSession?
        guard VTDecompressionSessionCreate(allocator: kCFAllocatorDefault, formatDescription: description, decoderSpecification: nil, imageBufferAttributes: [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA] as CFDictionary, outputCallback: nil, decompressionSessionOut: &decoder) == noErr, let decoder else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        defer { VTDecompressionSessionInvalidate(decoder) }
        let state = DecodeResult()
        guard VTDecompressionSessionDecodeFrame(decoder, sampleBuffer: sample, flags: [], infoFlagsOut: nil, outputHandler: { status, _, image, _, _ in state.set(status == noErr && image != nil) }) == noErr else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        VTDecompressionSessionWaitForAsynchronousFrames(decoder)
        guard state.value else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
    }
}
private final class DecodeResult: @unchecked Sendable {
    private let lock = NSLock()
    private var valid = false
    func set(_ next: Bool) { lock.lock(); valid = next; lock.unlock() }
    var value: Bool { lock.lock(); defer { lock.unlock() }; return valid }
}
