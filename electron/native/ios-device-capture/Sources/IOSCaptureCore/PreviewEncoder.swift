import Foundation
import AVFoundation
import CoreImage
import ImageIO
import VideoToolbox
import Darwin

public enum PreviewFraming {
    public static func record(jpeg: Data, generation: UInt32, sequence: UInt32) throws -> Data {
        guard !jpeg.isEmpty, jpeg.count <= 128 * 1024 else { throw CaptureFailure("INVALID_REQUEST") }
        var data = Data("RLIP".utf8)
        for value: UInt16 in [1, 0] { var big = value.bigEndian; withUnsafeBytes(of: &big) { data.append(contentsOf: $0) } }
        for value: UInt32 in [generation, sequence, UInt32(jpeg.count), 0] { var big = value.bigEndian; withUnsafeBytes(of: &big) { data.append(contentsOf: $0) } }
        data.append(jpeg); return data
    }
}
/// One queued conversion and one partial pipe record. Every descriptor write is nonblocking.
public final class PreviewEncoder {
    private let queue = DispatchQueue(label: "recordly.ios.preview", qos: .utility)
    private let lock = NSLock()
    private var enabled = false
    private var occupied = false
    private var lastSubmission = 0.0
    private var lastEncoding = 0.0
    private var lostCompressedContinuity = true
    private var sequence: UInt32 = 0
    private var packet: Data?
    private var offset = 0
    private var closed = false
    private let fd: Int32
    private let context = CIContext(options: [.cacheIntermediates: false])
    private var decoder: VTDecompressionSession?
    public init(fd: Int32 = 3) { self.fd = fd; if fcntl(fd, F_GETFD) >= 0 { _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK) } else { closed = true } }
    public func setEnabled(_ value: Bool) { lock.lock(); enabled = value; if !value { lostCompressedContinuity = true }; lock.unlock() }
    public func submit(_ sample: CMSampleBuffer, generation: UInt32) {
        let now = ProcessInfo.processInfo.systemUptime
        lock.lock()
        let compressed = CMSampleBufferGetImageBuffer(sample) == nil
        guard enabled, !occupied, compressed || now - lastSubmission >= 0.2 else {
            if compressed { lostCompressedContinuity = true }
            lock.unlock(); return
        }
        occupied = true; lastSubmission = now; lock.unlock()
        queue.async { [self] in
            defer { lock.lock(); occupied = false; lock.unlock() }
            guard !closed else { return }
            drain()
            autoreleasepool {
                let aperture = CMSampleBufferGetFormatDescription(sample).map { CMVideoFormatDescriptionGetCleanAperture($0, originIsAtTopLeft: false) }
                if let pixels = CMSampleBufferGetImageBuffer(sample) { encode(pixels, generation: generation, aperture: aperture); return }
                guard let description = CMSampleBufferGetFormatDescription(sample) else { return }
                lock.lock(); let discontinuity = lostCompressedContinuity; lock.unlock()
                if discontinuity {
                    guard VideoFormatPolicy.isSync(sample) else { return }
                    if let decoder { VTDecompressionSessionInvalidate(decoder) }; decoder = nil
                    lock.lock(); lostCompressedContinuity = false; lock.unlock()
                }
                if decoder == nil || !VTDecompressionSessionCanAcceptFormatDescription(decoder!, formatDescription: description) {
                    if let decoder { VTDecompressionSessionInvalidate(decoder) }; decoder = nil
                    guard VTDecompressionSessionCreate(allocator: kCFAllocatorDefault, formatDescription: description, decoderSpecification: nil, imageBufferAttributes: [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA] as CFDictionary, outputCallback: nil, decompressionSessionOut: &decoder) == noErr else { return }
                }
                guard let decoder else { return }
                _ = VTDecompressionSessionDecodeFrame(decoder, sampleBuffer: sample, flags: [], infoFlagsOut: nil) { [weak self] status, _, image, _, _ in
                    guard status == noErr, let image, let self else { return }
                    self.encode(image, generation: generation, aperture: aperture)
                }
                VTDecompressionSessionWaitForAsynchronousFrames(decoder)
            }
        }
    }
    private func encode(_ pixels: CVPixelBuffer, generation: UInt32, aperture: CGRect?) {
        let now = ProcessInfo.processInfo.systemUptime
        guard packet == nil, now - lastEncoding >= 0.2 else { return }
        lastEncoding = now
        var image = CIImage(cvPixelBuffer: pixels)
        if let aperture, !aperture.isEmpty, image.extent.contains(aperture) {
            image = image.cropped(to: aperture).transformed(by: CGAffineTransform(translationX: -aperture.minX, y: -aperture.minY))
        }
        let scale = min(1, 480 / max(image.extent.width, image.extent.height))
        let resized = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB), let jpeg = context.jpegRepresentation(of: resized, colorSpace: colorSpace, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.55]), jpeg.count <= 128 * 1024 else { return }
        sequence &+= 1; packet = try? PreviewFraming.record(jpeg: jpeg, generation: generation, sequence: sequence); offset = 0; drain()
    }
    private func drain() {
        guard let packet else { return }
        while offset < packet.count {
            let written = packet.withUnsafeBytes { write(fd, $0.baseAddress!.advanced(by: offset), packet.count - offset) }
            if written < 0 { if errno == EINTR { continue }; if errno == EAGAIN || errno == EWOULDBLOCK { return }; closed = true; self.packet = nil; return }
            guard written > 0 else { return }; offset += written
        }
        self.packet = nil; offset = 0
    }
    deinit { if let decoder { VTDecompressionSessionInvalidate(decoder) } }
}
