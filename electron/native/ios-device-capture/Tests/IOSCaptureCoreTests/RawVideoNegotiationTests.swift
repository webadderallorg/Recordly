import XCTest
import AVFoundation
import CoreVideo
@testable import IOSCaptureCore

final class RawVideoNegotiationTests: XCTestCase {
    func testQueuedCompressedSamplesWaitForSupportedRawAfterOneRequest() throws {
        var negotiation = RawVideoNegotiation()
        XCTAssertEqual(try negotiation.observe(rawPixelFormat: nil, supportsPassthrough: false, availablePixelFormats: [kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]), .requestRaw(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange))
        XCTAssertEqual(try negotiation.observe(rawPixelFormat: nil, supportsPassthrough: false, availablePixelFormats: []), .waitForRaw)
        // Even an old, otherwise eligible packet must not choose passthrough after the request.
        XCTAssertEqual(try negotiation.observe(rawPixelFormat: nil, supportsPassthrough: true, availablePixelFormats: []), .waitForRaw)
        XCTAssertEqual(try negotiation.observe(rawPixelFormat: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, supportsPassthrough: false, availablePixelFormats: []), .inspectSample)
    }

    func testUsesAdvertisedFullRangeWhenVideoRangeIsUnavailable() throws {
        var negotiation = RawVideoNegotiation()
        XCTAssertEqual(try negotiation.observe(rawPixelFormat: nil, supportsPassthrough: false, availablePixelFormats: [kCVPixelFormatType_32BGRA, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]), .requestRaw(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange))
        XCTAssertEqual(try negotiation.observe(rawPixelFormat: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, supportsPassthrough: false, availablePixelFormats: []), .inspectSample)
    }

    func testRejectsUnavailableConversionAndUnsupportedRawPixels() throws {
        var negotiation = RawVideoNegotiation()
        XCTAssertThrowsError(try negotiation.observe(rawPixelFormat: nil, supportsPassthrough: false, availablePixelFormats: [kCVPixelFormatType_32BGRA])) {
            XCTAssertEqual(($0 as? CaptureFailure)?.code, "UNSUPPORTED_FORMAT")
        }
        XCTAssertThrowsError(try negotiation.observe(rawPixelFormat: kCVPixelFormatType_32BGRA, supportsPassthrough: false, availablePixelFormats: [])) {
            XCTAssertEqual(($0 as? CaptureFailure)?.code, "UNSUPPORTED_FORMAT")
        }
    }

    func testNativeSupportedSamplesDoNotRequestConversion() throws {
        var negotiation = RawVideoNegotiation()
        XCTAssertEqual(try negotiation.observe(rawPixelFormat: nil, supportsPassthrough: true, availablePixelFormats: []), .inspectSample)
        XCTAssertEqual(try negotiation.observe(rawPixelFormat: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, supportsPassthrough: false, availablePixelFormats: []), .inspectSample)
    }

    func testPassthroughDoesNotQueryEncoderRecommendations() {
        let output = RecommendationOutput(codecs: [.h264])
        XCTAssertNil(CaptureEngine.recommendedVideoSettings(mode: "passthrough", output: output))
        XCTAssertEqual(output.codecQueries, 0)
        XCTAssertEqual(output.settingsQueries, 0)
    }

    func testUnavailableH264DoesNotQueryEncoderRecommendations() {
        let output = RecommendationOutput(codecs: [.hevc])
        XCTAssertNil(CaptureEngine.recommendedVideoSettings(mode: "h264-encode", output: output))
        XCTAssertEqual(output.codecQueries, 1)
        XCTAssertEqual(output.settingsQueries, 0)
    }

    func testAdvertisedH264RecommendationsRemainAvailableForEncoding() {
        let output = RecommendationOutput(codecs: [.h264])
        XCTAssertEqual(CaptureEngine.recommendedVideoSettings(mode: "h264-encode", output: output)?[AVVideoWidthKey] as? Int, 64)
        XCTAssertEqual(output.codecQueries, 1)
        XCTAssertEqual(output.settingsQueries, 1)
    }
}

/// Replaces only AVFoundation capability queries; never opens a device or session.
private final class RecommendationOutput: AVCaptureVideoDataOutput {
    let codecs: [AVVideoCodecType]
    var codecQueries = 0
    var settingsQueries = 0

    init(codecs: [AVVideoCodecType]) { self.codecs = codecs; super.init() }

    override func availableVideoCodecTypesForAssetWriter(writingTo outputFileType: AVFileType) -> [AVVideoCodecType] {
        XCTAssertEqual(outputFileType, .mov)
        codecQueries += 1
        return codecs
    }

    override func recommendedVideoSettings(forVideoCodecType videoCodecType: AVVideoCodecType, assetWriterOutputFileType outputFileType: AVFileType) -> [String: Any]? {
        XCTAssertEqual(videoCodecType, .h264)
        XCTAssertEqual(outputFileType, .mov)
        settingsQueries += 1
        return [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 64, AVVideoHeightKey: 96]
    }
}
