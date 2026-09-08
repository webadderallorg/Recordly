import XCTest
import AVFoundation
@testable import IOSCaptureCore

final class PassthroughTests: XCTestCase {
    private func samples(_ url: URL) async throws -> [CMSampleBuffer] {
        let asset = AVURLAsset(url: url)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let track = try XCTUnwrap(tracks.first)
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
        reader.add(output); XCTAssertTrue(reader.startReading())
        var values = [CMSampleBuffer]()
        while let sample = output.copyNextSampleBuffer() { if CMSampleBufferGetNumSamples(sample) > 0 { values.append(sample) } }
        return values
    }
    private func payload(_ sample: CMSampleBuffer) throws -> Data {
        let buffer = try XCTUnwrap(CMSampleBufferGetDataBuffer(sample))
        var data = Data(count: CMBlockBufferGetDataLength(buffer))
        let length = data.count
        let status = data.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(buffer, atOffset: 0, dataLength: length, destination: $0.baseAddress!) }
        XCTAssertEqual(status, noErr); return data
    }
    func testBaselinePacketsSurviveWriterAndSparseTail() async throws {
        let source = Bundle.module.url(forResource: "baseline", withExtension: "mov", subdirectory: "Fixtures")!
        let input = try await samples(source)
        let first = try XCTUnwrap(input.first)
        let (format, mode) = try VideoFormatPolicy.inspect(first)
        XCTAssertEqual(mode, "passthrough")
        try MediaInspector.validateFirstSample(first)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try VideoWriter(url: url, format: format, mode: mode, description: CMSampleBufferGetFormatDescription(first)!, boundary: .zero, recommended: nil)
        for sample in input { XCTAssertTrue(try writer.append(sample)) }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in writer.finish(at: CMTime(value: 300, timescale: 1)) { continuation.resume(with: $0) } }
        let output = try await samples(url)
        XCTAssertEqual(try input.map(payload), try output.map(payload))
        let inspected = try await MediaInspector.inspect(url: url)
        XCTAssertEqual(inspected["decodable"] as? Bool, true)
        let duration = inspected["duration"] as! [String: Any]
        XCTAssertEqual(Double(duration["value"] as! String)! / Double(duration["timescale"] as! Int32), 300, accuracy: 0.01)
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.requestedTimeToleranceBefore = .zero; generator.requestedTimeToleranceAfter = .zero
        _ = try await generator.image(at: CMTime(value: 299, timescale: 1))
    }
}
