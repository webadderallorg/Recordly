import CoreVideo

/// Confined to the capture queue. The engine's existing preparation deadline bounds waiting.
struct RawVideoNegotiation {
    enum Decision: Equatable {
        case inspectSample
        case requestRaw(OSType)
        case waitForRaw
    }

    private var requestedRaw = false

    mutating func observe(rawPixelFormat: OSType?, supportsPassthrough: Bool, availablePixelFormats: [OSType]) throws -> Decision {
        if let rawPixelFormat {
            guard [kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange].contains(rawPixelFormat) else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
            return .inspectSample
        }
        // Changing output settings does not make already queued compressed samples raw.
        if requestedRaw { return .waitForRaw }
        if supportsPassthrough { return .inspectSample }
        let supported = [kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        guard let pixelFormat = supported.first(where: availablePixelFormats.contains) else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
        requestedRaw = true
        return .requestRaw(pixelFormat)
    }
}
