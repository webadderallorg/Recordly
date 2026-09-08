import Foundation
import AVFoundation
import CoreMedia
import CryptoKit

public struct IOSVideoFormat: Codable {
    public let codedWidth: Int
    public let codedHeight: Int
    public let displayWidth: Double
    public let displayHeight: Double
    public let codec: String
    public let colorPrimaries: String?
    public let transferFunction: String?
    public let ycbcrMatrix: String?
    public let fullRange: Bool?
    public let transform: [Double]
    public var observedFrameRate: Double?
    public let fingerprint: String
}
public struct VideoBoundary {
    public let boundary: CMTime
    public private(set) var started = false
    public init(boundary: CMTime) { self.boundary = boundary }
    public mutating func accept(pts: CMTime, isSync: Bool) -> Bool {
        if !started { guard pts >= boundary && isSync else { return false }; started = true }
        return true
    }
}
public enum VideoFormatPolicy {
    public static func bitrate(width: Int, height: Int, fps: Double) -> Int { Int(min(60000000, max(12000000, Double(width * height) * fps * 0.12))) }
    public static func validateGeometry(width: Int, height: Int) throws {
        guard width > 0, height > 0, width <= 8192, height <= 8192, width % 2 == 0, height % 2 == 0 else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
    }
    public static func inspect(_ sample: CMSampleBuffer) throws -> (IOSVideoFormat, String) {
        guard let description = CMSampleBufferGetFormatDescription(sample), CMFormatDescriptionGetMediaType(description) == kCMMediaType_Video else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        let mediaBytes = CMSampleBufferGetImageBuffer(sample).map(CVPixelBufferGetDataSize) ?? CMSampleBufferGetTotalSampleSize(sample)
        guard mediaBytes <= 64 * 1024 * 1024 else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        let dimensions = CMVideoFormatDescriptionGetDimensions(description)
        try validateGeometry(width: Int(dimensions.width), height: Int(dimensions.height))
        let aperture = CMVideoFormatDescriptionGetCleanAperture(description, originIsAtTopLeft: true)
        guard aperture.origin == .zero, Int(dimensions.width) - Int(aperture.width) <= 1, Int(dimensions.height) - Int(aperture.height) <= 1, aperture.width > 0, aperture.height > 0 else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        let display = CMVideoFormatDescriptionGetPresentationDimensions(description, usePixelAspectRatio: true, useCleanAperture: true)
        guard display.width == aperture.width, display.height == aperture.height else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        let extensions = (CMFormatDescriptionGetExtensions(description) ?? [:] as CFDictionary) as NSDictionary
        let primaries = extensions[kCMFormatDescriptionExtension_ColorPrimaries] as? String
        let transfer = extensions[kCMFormatDescriptionExtension_TransferFunction] as? String
        let matrix = extensions[kCMFormatDescriptionExtension_YCbCrMatrix] as? String
        let supportsSRGB: Bool
        // USB screen capture can use sRGB transfer with Rec.709 primaries/matrix.
        // Asset-writer sRGB tagging is supported from macOS 15; preserve its actual tag.
        if #available(macOS 15, *) { supportsSRGB = transfer == kCMFormatDescriptionTransferFunction_sRGB as String }
        else { supportsSRGB = false }
        guard primaries == kCMFormatDescriptionColorPrimaries_ITU_R_709_2 as String,
              transfer == kCMFormatDescriptionTransferFunction_ITU_R_709_2 as String || supportsSRGB,
              matrix == kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2 as String else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        let subtype = CMFormatDescriptionGetMediaSubType(description)
        let raw = CMSampleBufferGetImageBuffer(sample) != nil
        guard raw ? [kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange].contains(subtype) : supportsPassthrough(description) else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        let codec = raw ? String(format: "%08x", subtype) : "h264"
        let canonical: [String: Any] = ["width": dimensions.width, "height": dimensions.height, "subtype": subtype, "extensions": extensions]
        // Property-list canonicalization includes codec configuration, aperture, range and colour.
        let bytes = try JSONSerialization.data(withJSONObject: canonicalJSON(canonical), options: [.sortedKeys])
        let fingerprint = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let fullRange = raw ? subtype == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange : extensions[kCMFormatDescriptionExtension_FullRangeVideo] as? Bool
        return (IOSVideoFormat(codedWidth: Int(dimensions.width), codedHeight: Int(dimensions.height), displayWidth: display.width, displayHeight: display.height, codec: codec, colorPrimaries: primaries, transferFunction: transfer, ycbcrMatrix: matrix, fullRange: fullRange, transform: [1,0,0,1,0,0], observedFrameRate: nil, fingerprint: fingerprint), raw ? "h264-encode" : "passthrough")
    }
    public static func supportsPassthrough(_ description: CMFormatDescription) -> Bool {
        guard CMFormatDescriptionGetMediaSubType(description) == kCMVideoCodecType_H264 else { return false }
        var bytes: UnsafePointer<UInt8>?
        var size = 0
        guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(description, parameterSetIndex: 0, parameterSetPointerOut: &bytes, parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let bytes, size >= 4 else { return false }
        // Baseline profile cannot contain B slices. Other profiles must renegotiate raw
        // until their reordered sparse-tail behavior has a validated compatibility policy.
        return bytes[1] == 66
    }
    public static func isSync(_ sample: CMSampleBuffer) -> Bool {
        guard let entries = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]], let first = entries.first else { return true }
        return !(first[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
    }
}

/// Confined to CaptureEngine.queue. One retained tail buffer; no unbounded media staging.
public final class VideoWriter {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    public let format: IOSVideoFormat
    public let mode: String
    private var boundary: VideoBoundary
    private var pending: CMSampleBuffer?
    private var maxPTS = CMTime.invalid
    private var lastDTS = CMTime.invalid
    public private(set) var firstHostTime: CMTime?
    public private(set) var sampleCount = 0
    public private(set) var endHostTime: CMTime?
    public init(url: URL, format: IOSVideoFormat, mode: String, description: CMFormatDescription, boundary: CMTime, recommended: [String: Any]?) throws {
        self.format = format; self.mode = mode; self.boundary = VideoBoundary(boundary: boundary)
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        writer.movieFragmentInterval = CMTime(value: 10, timescale: 1)
        writer.initialMovieFragmentInterval = CMTime(value: 1, timescale: 1)
        var settings: [String: Any]?
        if mode == "h264-encode" {
            guard var config = recommended else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
            config[AVVideoCodecKey] = AVVideoCodecType.h264
            config[AVVideoWidthKey] = format.codedWidth; config[AVVideoHeightKey] = format.codedHeight
            config[AVVideoCompressionPropertiesKey] = [AVVideoAverageBitRateKey: VideoFormatPolicy.bitrate(width: format.codedWidth, height: format.codedHeight, fps: format.observedFrameRate ?? 30), AVVideoMaxKeyFrameIntervalDurationKey: 2, AVVideoAllowFrameReorderingKey: false]
            config[AVVideoCleanApertureKey] = [AVVideoCleanApertureWidthKey: format.displayWidth, AVVideoCleanApertureHeightKey: format.displayHeight, AVVideoCleanApertureHorizontalOffsetKey: (format.displayWidth - Double(format.codedWidth)) / 2, AVVideoCleanApertureVerticalOffsetKey: (format.displayHeight - Double(format.codedHeight)) / 2]
            config[AVVideoColorPropertiesKey] = [AVVideoColorPrimariesKey: format.colorPrimaries!, AVVideoTransferFunctionKey: format.transferFunction!, AVVideoYCbCrMatrixKey: format.ycbcrMatrix!]
            guard writer.canApply(outputSettings: config, forMediaType: .video) else { throw CaptureFailure("UNSUPPORTED_FORMAT") }; settings = config
        }
        input = AVAssetWriterInput(mediaType: .video, outputSettings: settings, sourceFormatHint: description)
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw CaptureFailure("UNSUPPORTED_FORMAT") }; writer.add(input)
    }
    public func append(_ sourceSample: CMSampleBuffer) throws -> Bool {
        let sample = try VideoFormatPolicy.normalizeRawGeometry(sourceSample)
        let (next, nextMode) = try VideoFormatPolicy.inspect(sample)
        guard next.fingerprint == format.fingerprint, nextMode == mode else { throw CaptureFailure("FORMAT_CHANGED") }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        guard pts.isNumeric else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
        guard boundary.accept(pts: pts, isSync: mode == "h264-encode" || VideoFormatPolicy.isSync(sample)) else { return false }
        let dts = CMSampleBufferGetDecodeTimeStamp(sample)
        if dts.isNumeric, lastDTS.isNumeric, dts < lastDTS { throw CaptureFailure("WRITER_FAILED") }
        if dts.isNumeric { lastDTS = dts }
        if firstHostTime == nil {
            guard writer.startWriting() else { throw CaptureFailure("WRITER_FAILED") }
            writer.startSession(atSourceTime: pts); firstHostTime = pts
        }
        if let pending { try appendNow(pending) }
        pending = sample; maxPTS = maxPTS.isNumeric ? CMTimeMaximum(maxPTS, pts) : pts
        sampleCount += 1
        return true
    }
    private func appendNow(_ sample: CMSampleBuffer) throws {
        guard writer.status == .writing, input.isReadyForMoreMediaData, input.append(sample) else { throw CaptureFailure("WRITER_FAILED") }
    }
    public func finish(at stop: CMTime, completion: @escaping (Result<Void, Error>) -> Void) {
        do {
            guard let firstHostTime, let pending, sampleCount > 0 else { writer.cancelWriting(); throw CaptureFailure("NO_VIDEO_SAMPLES") }
            let pts = CMSampleBufferGetPresentationTimeStamp(pending)
            guard stop > firstHostTime, stop >= maxPTS else { throw CaptureFailure("FINALIZATION_FAILED") }
            // A reordered final sample cannot be extended without retaining/rebuilding a GOP.
            // Preserve existing fragments and fail honestly rather than inventing a sparse tail.
            guard pts == maxPTS else { throw CaptureFailure("FINALIZATION_FAILED") }
            var count = 0
            CMSampleBufferGetSampleTimingInfoArray(pending, entryCount: 0, arrayToFill: nil, entriesNeededOut: &count)
            guard count == 1 else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
            var info = CMSampleTimingInfo()
            CMSampleBufferGetSampleTimingInfo(pending, at: 0, timingInfoOut: &info)
            info.duration = CMTimeSubtract(stop, pts)
            var extended: CMSampleBuffer?
            guard CMSampleBufferCreateCopyWithNewTiming(allocator: kCFAllocatorDefault, sampleBuffer: pending, sampleTimingEntryCount: 1, sampleTimingArray: &info, sampleBufferOut: &extended) == noErr, let extended else { throw CaptureFailure("WRITER_FAILED") }
            try appendNow(extended); self.pending = nil; endHostTime = stop
            writer.endSession(atSourceTime: stop); input.markAsFinished()
            writer.finishWriting { [writer] in completion(writer.status == .completed ? .success(()) : .failure(CaptureFailure("FINALIZATION_FAILED"))) }
        } catch {
            input.markAsFinished()
            if writer.status == .writing {
                writer.finishWriting { completion(.failure(error)) }
            } else { completion(.failure(error)) }
        }
    }
}

public func jsonObject(_ value: IOSVideoFormat) throws -> [String: Any] {
    var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
    for key in ["colorPrimaries", "transferFunction", "ycbcrMatrix", "fullRange", "observedFrameRate"] where object[key] == nil { object[key] = NSNull() }
    return object
}

private func canonicalJSON(_ value: Any) -> Any {
    if let data = value as? Data { return data.base64EncodedString() }
    if let dictionary = value as? [String: Any] { return dictionary.mapValues(canonicalJSON) }
    if let array = value as? [Any] { return array.map(canonicalJSON) }
    return value
}

extension VideoFormatPolicy {
    /// Copies planar SDR pixels exactly; the extra right/bottom edge is padding, never a crop.
    public static func normalizeRawGeometry(_ sample: CMSampleBuffer) throws -> CMSampleBuffer {
        guard let source = CMSampleBufferGetImageBuffer(sample) else { return sample }
        let width = CVPixelBufferGetWidth(source), height = CVPixelBufferGetHeight(source)
        guard width % 2 != 0 || height % 2 != 0 else { return sample }
        let type = CVPixelBufferGetPixelFormatType(source)
        guard [kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange].contains(type), width < 8192, height < 8192 else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        var output: CVPixelBuffer?
        guard CVPixelBufferCreate(kCFAllocatorDefault, width + width % 2, height + height % 2, type, nil, &output) == kCVReturnSuccess, let output else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        CVPixelBufferLockBaseAddress(source, .readOnly); CVPixelBufferLockBaseAddress(output, [])
        defer { CVPixelBufferUnlockBaseAddress(source, .readOnly); CVPixelBufferUnlockBaseAddress(output, []) }
        for plane in 0..<2 {
            let rowBytes = CVPixelBufferGetBytesPerRowOfPlane(output, plane)
            let destination = CVPixelBufferGetBaseAddressOfPlane(output, plane)!
            memset(destination, plane == 0 ? (type == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange ? 0 : 16) : 128, rowBytes * CVPixelBufferGetHeightOfPlane(output, plane))
            let input = CVPixelBufferGetBaseAddressOfPlane(source, plane)!
            for row in 0..<CVPixelBufferGetHeightOfPlane(source, plane) {
                memcpy(destination.advanced(by: row * rowBytes), input.advanced(by: row * CVPixelBufferGetBytesPerRowOfPlane(source, plane)), plane == 0 ? width : ((width + 1) / 2) * 2)
            }
        }
        CVBufferPropagateAttachments(source, output)
        CVBufferSetAttachment(output, kCVImageBufferCleanApertureKey, [kCVImageBufferCleanApertureWidthKey: width, kCVImageBufferCleanApertureHeightKey: height, kCVImageBufferCleanApertureHorizontalOffsetKey: -Double(width % 2) / 2, kCVImageBufferCleanApertureVerticalOffsetKey: -Double(height % 2) / 2] as CFDictionary, .shouldPropagate)
        var description: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: output, formatDescriptionOut: &description) == noErr, let description else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        var timing = CMSampleTimingInfo()
        guard CMSampleBufferGetSampleTimingInfo(sample, at: 0, timingInfoOut: &timing) == noErr else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
        var result: CMSampleBuffer?
        guard CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: output, formatDescription: description, sampleTiming: &timing, sampleBufferOut: &result) == noErr, let result else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        return result
    }
}
