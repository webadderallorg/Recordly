import XCTest
import AVFoundation
import CoreVideo
@testable import IOSCaptureCore

func syntheticVideoSample(width: Int = 64, height: Int = 96, seconds: Double = 100, primaries: CFString = kCVImageBufferColorPrimaries_ITU_R_709_2, transfer: CFString = kCVImageBufferTransferFunction_ITU_R_709_2, matrix: CFString = kCVImageBufferYCbCrMatrix_ITU_R_709_2) throws -> CMSampleBuffer {
    var pixels: CVPixelBuffer?
    XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixels), kCVReturnSuccess)
    let buffer = try XCTUnwrap(pixels)
    CVPixelBufferLockBaseAddress(buffer, [])
    for plane in 0..<CVPixelBufferGetPlaneCount(buffer) {
        memset(CVPixelBufferGetBaseAddressOfPlane(buffer, plane), plane == 0 ? 64 : 128, CVPixelBufferGetBytesPerRowOfPlane(buffer, plane) * CVPixelBufferGetHeightOfPlane(buffer, plane))
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])
    CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, primaries, .shouldPropagate)
    CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, transfer, .shouldPropagate)
    CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, matrix, .shouldPropagate)
    var description: CMVideoFormatDescription?
    XCTAssertEqual(CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescriptionOut: &description), noErr)
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 30), presentationTimeStamp: CMTime(seconds: seconds, preferredTimescale: 600), decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    XCTAssertEqual(CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescription: description!, sampleTiming: &timing, sampleBufferOut: &sample), noErr)
    return try XCTUnwrap(sample)
}

final class MediaInspectorTests: XCTestCase {
    func testObservedSRGBScreenEncodesWithoutRelabelingOrChangingPixelLevels() async throws {
        guard #available(macOS 15, *) else { throw XCTSkip("sRGB asset-writer tagging requires macOS 15") }
        // Matches the raw format observed after negotiating the USB iPhone's High-profile H.264.
        let sample = try syntheticVideoSample(width: 1206, height: 2622, transfer: kCVImageBufferTransferFunction_sRGB)
        let source = try XCTUnwrap(CMSampleBufferGetImageBuffer(sample))
        let levels: [UInt8] = [16, 64, 128, 192, 235]
        let chroma: [(UInt8, UInt8)] = [(128, 128), (96, 160), (160, 96), (96, 96), (160, 160)]
        let width = CVPixelBufferGetWidth(source)
        let lumaRow = (0..<width).map { levels[$0 * levels.count / width] }
        let chromaRow = (0..<width).map { column in
            let value = chroma[(column / 2 * 2) * chroma.count / width]
            return column % 2 == 0 ? value.0 : value.1
        }
        XCTAssertEqual(CVPixelBufferLockBaseAddress(source, []), kCVReturnSuccess)
        for (plane, row) in [lumaRow, chromaRow].enumerated() {
            let base = try XCTUnwrap(CVPixelBufferGetBaseAddressOfPlane(source, plane))
            row.withUnsafeBytes { bytes in
                for y in 0..<CVPixelBufferGetHeightOfPlane(source, plane) {
                    memcpy(base.advanced(by: y * CVPixelBufferGetBytesPerRowOfPlane(source, plane)), bytes.baseAddress!, row.count)
                }
            }
        }
        CVPixelBufferUnlockBaseAddress(source, [])
        let (format, mode) = try VideoFormatPolicy.inspect(sample)
        XCTAssertEqual(format.transferFunction, "IEC_sRGB")
        XCTAssertEqual(format.fullRange, false)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try VideoWriter(url: url, format: format, mode: mode, description: CMSampleBufferGetFormatDescription(sample)!, boundary: .zero, recommended: [:])
        XCTAssertTrue(try writer.append(sample))
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            writer.finish(at: CMTime(value: 101, timescale: 1)) { continuation.resume(with: $0) }
        }
        let inspection = try await MediaInspector.inspect(url: url)
        XCTAssertEqual(inspection["decodable"] as? Bool, true)
        let video = try XCTUnwrap(inspection["video"] as? [String: Any])
        XCTAssertEqual(video["colorPrimaries"] as? String, "ITU_R_709_2")
        XCTAssertEqual(video["transferFunction"] as? String, "IEC_sRGB")
        XCTAssertEqual(video["ycbcrMatrix"] as? String, "ITU_R_709_2")
        XCTAssertEqual(video["codedWidth"] as? Int, 1206)
        XCTAssertEqual(video["codedHeight"] as? Int, 2622)
        XCTAssertEqual(video["displayWidth"] as? Double, 1206)
        XCTAssertEqual(video["displayHeight"] as? Double, 2622)

        let asset = AVURLAsset(url: url)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let track = try XCTUnwrap(tracks.first)
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
        XCTAssertTrue(reader.canAdd(output)); reader.add(output)
        XCTAssertTrue(reader.startReading())
        defer { reader.cancelReading() }
        let decoded = try XCTUnwrap(output.copyNextSampleBuffer())
        let pixels = try XCTUnwrap(CMSampleBufferGetImageBuffer(decoded))
        XCTAssertEqual(CVPixelBufferGetWidth(pixels), 1206)
        XCTAssertEqual(CVPixelBufferGetHeight(pixels), 2622)
        XCTAssertEqual(CVPixelBufferGetPixelFormatType(pixels), kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange)
        XCTAssertEqual(CVPixelBufferLockBaseAddress(pixels, .readOnly), kCVReturnSuccess)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
        let yBase = try XCTUnwrap(CVPixelBufferGetBaseAddressOfPlane(pixels, 0)).assumingMemoryBound(to: UInt8.self)
        let uvBase = try XCTUnwrap(CVPixelBufferGetBaseAddressOfPlane(pixels, 1)).assumingMemoryBound(to: UInt8.self)
        var decodedLevels: [Int] = []
        for index in levels.indices {
            let x = width * (2 * index + 1) / (2 * levels.count)
            let y = Int(yBase[1310 * CVPixelBufferGetBytesPerRowOfPlane(pixels, 0) + x])
            let uv = 655 * CVPixelBufferGetBytesPerRowOfPlane(pixels, 1) + x / 2 * 2
            decodedLevels.append(y)
            // Flat patch centers avoid chroma edges; three code values allow H.264 quantization.
            XCTAssertEqual(Double(y), Double(levels[index]), accuracy: 3)
            XCTAssertEqual(Double(uvBase[uv]), Double(chroma[index].0), accuracy: 3)
            XCTAssertEqual(Double(uvBase[uv + 1]), Double(chroma[index].1), accuracy: 3)
        }
        print("sRGB round trip: 1206x2622, \(video["colorPrimaries"]!), \(video["transferFunction"]!), \(video["ycbcrMatrix"]!), decoded luma \(decodedLevels)")
    }

    func testSRGBSupportDoesNotAdmitUntestedColourTriplets() throws {
        let rejected: [(CFString, CFString, CFString)] = [
            (kCVImageBufferColorPrimaries_P3_D65, kCVImageBufferTransferFunction_sRGB, kCVImageBufferYCbCrMatrix_ITU_R_709_2),
            (kCVImageBufferColorPrimaries_ITU_R_709_2, kCVImageBufferTransferFunction_SMPTE_ST_2084_PQ, kCVImageBufferYCbCrMatrix_ITU_R_709_2),
            (kCVImageBufferColorPrimaries_ITU_R_709_2, kCVImageBufferTransferFunction_ITU_R_2100_HLG, kCVImageBufferYCbCrMatrix_ITU_R_709_2),
            (kCVImageBufferColorPrimaries_ITU_R_709_2, "unknown" as CFString, kCVImageBufferYCbCrMatrix_ITU_R_709_2),
            (kCVImageBufferColorPrimaries_ITU_R_709_2, kCVImageBufferTransferFunction_sRGB, kCVImageBufferYCbCrMatrix_ITU_R_601_4),
        ]
        for (primaries, transfer, matrix) in rejected {
            let sample = try syntheticVideoSample(primaries: primaries, transfer: transfer, matrix: matrix)
            XCTAssertThrowsError(try VideoFormatPolicy.inspect(sample)) {
                XCTAssertEqual(($0 as? CaptureFailure)?.code, "UNSUPPORTED_FORMAT")
            }
        }
        if #available(macOS 15, *) {} else {
            XCTAssertThrowsError(try VideoFormatPolicy.inspect(syntheticVideoSample(transfer: kCVImageBufferTransferFunction_sRGB)))
        }
    }

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
