import XCTest
import AVFoundation
import CoreVideo
@testable import IOSCaptureCore

func syntheticVideoSample(width: Int = 64, height: Int = 96, seconds: Double = 100, primaries: CFString = kCVImageBufferColorPrimaries_ITU_R_709_2) throws -> CMSampleBuffer {
    var pixels: CVPixelBuffer?
    XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixels), kCVReturnSuccess)
    let buffer = try XCTUnwrap(pixels)
    CVPixelBufferLockBaseAddress(buffer, [])
    for plane in 0..<CVPixelBufferGetPlaneCount(buffer) {
        memset(CVPixelBufferGetBaseAddressOfPlane(buffer, plane), plane == 0 ? 64 : 128, CVPixelBufferGetBytesPerRowOfPlane(buffer, plane) * CVPixelBufferGetHeightOfPlane(buffer, plane))
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])
    CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, primaries, .shouldPropagate)
    CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
    CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
    var description: CMVideoFormatDescription?
    XCTAssertEqual(CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescriptionOut: &description), noErr)
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 30), presentationTimeStamp: CMTime(seconds: seconds, preferredTimescale: 600), decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    XCTAssertEqual(CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescription: description!, sampleTiming: &timing, sampleBufferOut: &sample), noErr)
    return try XCTUnwrap(sample)
}

final class MediaInspectorTests: XCTestCase {
    func testUntestedWideColourIsRejectedBeforeWriting() throws {
        XCTAssertThrowsError(try VideoFormatPolicy.inspect(syntheticVideoSample(primaries: kCVImageBufferColorPrimaries_P3_D65)))
    }
    func testZeroFrameWriterNeverReportsSuccess() async throws {
        let sample = try syntheticVideoSample()
        let (format, mode) = try VideoFormatPolicy.inspect(sample)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try VideoWriter(url: url, format: format, mode: mode, description: CMSampleBufferGetFormatDescription(sample)!, boundary: .zero, recommended: [:])
        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in writer.finish(at: CMTime(value: 1, timescale: 1)) { continuation.resume(with: $0) } }
            XCTFail("empty movie reported complete")
        } catch { XCTAssertEqual((error as? CaptureFailure)?.code, "NO_VIDEO_SAMPLES") }
    }

    func testOddGeometryPadsWithoutCroppingDisplayAperture() async throws {
        let raw = try syntheticVideoSample(width: 63, height: 95)
        let sample = try VideoFormatPolicy.normalizeRawGeometry(raw)
        let (format, _) = try VideoFormatPolicy.inspect(sample)
        XCTAssertEqual(format.codedWidth, 64)
        XCTAssertEqual(format.codedHeight, 96)
        XCTAssertEqual(format.displayWidth, 63)
        XCTAssertEqual(format.displayHeight, 95)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try VideoWriter(url: url, format: format, mode: "h264-encode", description: CMSampleBufferGetFormatDescription(sample)!, boundary: .zero, recommended: [:])
        XCTAssertTrue(try writer.append(sample))
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in writer.finish(at: CMTime(value: 101, timescale: 1)) { continuation.resume(with: $0) } }
        let inspection = try await MediaInspector.inspect(url: url)
        let video = inspection["video"] as! [String: Any]
        XCTAssertEqual(video["displayWidth"] as? Double, 63)
        XCTAssertEqual(video["displayHeight"] as? Double, 95)
    }

    func testSparseSingleFrameRetainsFiveMinuteTimelineAndDecodes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let sample = try syntheticVideoSample()
        let (format, mode) = try VideoFormatPolicy.inspect(sample)
        let url = directory.appendingPathComponent("source.mov")
        let writer = try VideoWriter(url: url, format: format, mode: mode, description: CMSampleBufferGetFormatDescription(sample)!, boundary: CMTime(value: 100, timescale: 1), recommended: [:])
        XCTAssertTrue(try writer.append(sample))
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in writer.finish(at: CMTime(value: 400, timescale: 1)) { continuation.resume(with: $0) } }
        let inspected = try await MediaInspector.inspect(url: url)
        XCTAssertEqual(inspected["decodable"] as? Bool, true)
        let duration = inspected["duration"] as! [String: Any]
        XCTAssertEqual(Double(duration["value"] as! String)! / Double(duration["timescale"] as! Int32), 300, accuracy: 0.01)
        XCTAssertEqual((inspected["video"] as? [String: Any])?["codedWidth"] as? Int, 64)
    }
    func testRejectsTruncatedAndEmptyMedia() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        try Data("invalid movie".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        do { _ = try await MediaInspector.inspect(url: url); XCTFail("corrupt media accepted") } catch {}
    }
    func testRejectsFormatChangeBeforeAcceptingSample() throws {
        let sample = try syntheticVideoSample()
        let (format, mode) = try VideoFormatPolicy.inspect(sample)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try VideoWriter(url: url, format: format, mode: mode, description: CMSampleBufferGetFormatDescription(sample)!, boundary: .zero, recommended: [:])
        XCTAssertThrowsError(try writer.append(syntheticVideoSample(width: 66)))
        XCTAssertEqual(writer.sampleCount, 0)
    }
}
