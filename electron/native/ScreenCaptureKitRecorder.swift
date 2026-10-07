import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreGraphics
import CoreImage

struct CaptureConfig: Codable {
	let fps: Int?
	let displayId: CGDirectDisplayID?
	let windowId: UInt32?
	let windowX: Double?
	let windowY: Double?
	let windowWidth: Double?
	let windowHeight: Double?
	let outputPath: String?
	let capturesSystemAudio: Bool?
	let capturesMicrophone: Bool?
	let systemAudioOutputPath: String?
	let microphoneDeviceId: String?
	let microphoneLabel: String?
	let microphoneOutputPath: String?
	let excludedProcessIds: [Int32]?
}

let targetCaptureFPS = 60
/// How long finalization waits for a backed-up encoder queue before giving up on
/// the optional tail frame: 100 polls x 10 ms = 1 s.
let writerReadinessPollAttempts = 100
let writerReadinessPollInterval: UInt64 = 10_000_000
/// How long finalization waits for queued inline audio to reach the writer: 500 x 10 ms = 5 s.
let inlineAudioDrainPollAttempts = 500
/// While the screen is still, the last frame is written again this often.
let stillFrameInterval = CMTime(value: 1, timescale: 1)
/// Longest a captured frame takes to reach the recorder.
let stillFrameDeliveryAllowance = CMTime(value: 1, timescale: 10)

/// Maps capture timestamps onto the recording timeline. The first accepted video frame
/// is time zero and paused intervals are removed, for video and audio alike. The video
/// and audio queues both read it, so every access takes the lock.
final class RecordingClock {
	private let lock = NSLock()
	private var origin: CMTime = .invalid
	private var pausedDuration: CMTime = .zero
	private var pauseStartedAt: CMTime?

	static func hostTime() -> CMTime {
		CMClockGetTime(CMClockGetHostTimeClock())
	}

	func reset() {
		lock.lock()
		defer { lock.unlock() }
		origin = .invalid
		pausedDuration = .zero
		pauseStartedAt = nil
	}

	/// Timeline time of a video frame. The first frame asked about becomes time zero.
	func videoTime(for sampleTime: CMTime) -> CMTime? {
		lock.lock()
		defer { lock.unlock() }
		guard pauseStartedAt == nil else { return nil }
		if !origin.isValid {
			origin = sampleTime
		}
		return max(.zero, sampleTime - origin - pausedDuration)
	}

	/// Forgets time zero when the frame that set it could not be written.
	func clearOrigin() {
		lock.lock()
		defer { lock.unlock() }
		origin = .invalid
		pausedDuration = .zero
	}

	/// Timeline time of an audio buffer, or nil while paused or before the first frame.
	/// Audio captured just before the first frame comes back negative; the track trims it.
	func audioTime(for sampleTime: CMTime) -> CMTime? {
		lock.lock()
		defer { lock.unlock() }
		guard origin.isValid, pauseStartedAt == nil else { return nil }
		return sampleTime - origin - pausedDuration
	}

	/// Timeline position of a host time, held at the pause point while paused.
	func timelineTime(atHostTime hostTime: CMTime) -> CMTime? {
		lock.lock()
		defer { lock.unlock() }
		guard origin.isValid else { return nil }
		let effectiveTime = pauseStartedAt.map { min($0, hostTime) } ?? hostTime
		return max(.zero, effectiveTime - origin - pausedDuration)
	}

	func pause(atHostTime hostTime: CMTime) {
		lock.lock()
		defer { lock.unlock() }
		if pauseStartedAt == nil {
			pauseStartedAt = hostTime
		}
	}

	/// Resumes on the host clock, so audio is accepted again immediately. Anchoring the
	/// resume to the next video frame instead dropped speech after the countdown until
	/// something on screen changed.
	func resume(atHostTime hostTime: CMTime) {
		lock.lock()
		defer { lock.unlock() }
		guard let pauseStartedAt else { return }
		if origin.isValid, hostTime > pauseStartedAt {
			pausedDuration = pausedDuration + (hostTime - pauseStartedAt)
		}
		self.pauseStartedAt = nil
	}
}

/// One audio stream laid onto the recording timeline as 48 kHz stereo.
///
/// Each buffer lands at its presentation time: silence fills delivery gaps and frames
/// that overlap audio already written are trimmed, so the track spans the video from
/// time zero to the end. Nothing is dropped for a busy encoder. The sidecar file
/// encodes synchronously and the inline track queues buffers until its writer input is
/// ready. Dropping refused buffers is what spliced recordings into garbled audio that
/// ran shorter than the video. All methods run on the recorder's audio queue, or after
/// that queue has drained.
final class AudioTimelineTrack {
	static let sampleRate = 48_000.0
	static let format = AVAudioFormat(
		commonFormat: .pcmFormatFloat32,
		sampleRate: sampleRate,
		channels: 2,
		interleaved: false
	)!
	/// Timestamp jitter up to one buffer is absorbed so clock noise never becomes a splice.
	static let alignmentToleranceFrames: Int64 = 960
	/// A larger jump than this is a broken timestamp, not a gap worth of silence.
	static let maxSilenceFillFrames: Int64 = 48_000 * 60 * 30
	private static let silenceChunkFrames: Int64 = 4_800

	let label: String
	private var sidecar: AVAudioFile?
	private var sidecarError: Error?
	private let inlineInput: AVAssetWriterInput?
	private weak var inlineWriter: AVAssetWriter?
	private var pendingInline: [CMSampleBuffer] = []
	private var converter: AVAudioConverter?
	private var limitFrame: Int64?
	private(set) var framesWritten: Int64 = 0

	init(label: String, sidecarURL: URL?, sidecarBitRate: Int, inlineInput: AVAssetWriterInput?, inlineWriter: AVAssetWriter?) throws {
		self.label = label
		self.inlineInput = inlineInput
		self.inlineWriter = inlineWriter
		if let sidecarURL {
			sidecar = try AVAudioFile(
				forWriting: sidecarURL,
				settings: [
					AVFormatIDKey: kAudioFormatMPEG4AAC,
					AVSampleRateKey: Self.sampleRate,
					AVNumberOfChannelsKey: 2,
					AVEncoderBitRateKey: sidecarBitRate,
				],
				commonFormat: .pcmFormatFloat32,
				interleaved: false
			)
		}
	}

	var endTime: CMTime {
		CMTime(value: framesWritten, timescale: CMTimeScale(Self.sampleRate))
	}

	func append(_ sampleBuffer: CMSampleBuffer, at time: CMTime) {
		guard let source = Self.pcmBuffer(from: sampleBuffer),
			  let converted = convert(source) else { return }

		let startFrame = Int64((time.seconds * Self.sampleRate).rounded())
		var skipFrames: Int64 = 0
		let drift = startFrame - framesWritten
		if drift > Self.alignmentToleranceFrames && drift <= Self.maxSilenceFillFrames {
			writeSilence(frames: limited(drift))
		} else if drift < -Self.alignmentToleranceFrames {
			skipFrames = min(-drift, Int64(converted.frameLength))
		}

		var keepFrames = Int64(converted.frameLength) - skipFrames
		if let limitFrame {
			keepFrames = min(keepFrames, max(0, limitFrame - framesWritten))
		}
		guard keepFrames > 0 else { return }
		if skipFrames == 0 && keepFrames == Int64(converted.frameLength) {
			write(converted)
		} else if let slice = Self.slice(converted, from: skipFrames, count: keepFrames) {
			write(slice)
		}
	}

	/// Stops the track at `frame`; later audio is trimmed off.
	func limit(atFrame frame: Int64) {
		limitFrame = max(0, frame)
	}

	/// Pads the track with silence to `endFrame`, flushes queued inline audio and closes
	/// the sidecar. Returns the sidecar error, if writing it failed.
	func finish(padTo endFrame: Int64) async -> Error? {
		limitFrame = nil
		if endFrame > framesWritten {
			writeSilence(frames: endFrame - framesWritten)
		}
		var attemptsRemaining = inlineAudioDrainPollAttempts
		drainInline()
		while !pendingInline.isEmpty, inlineWriter?.status == .writing, attemptsRemaining > 0 {
			attemptsRemaining -= 1
			try? await Task.sleep(nanoseconds: writerReadinessPollInterval)
			drainInline()
		}
		if !pendingInline.isEmpty {
			fputs("Warning: \(pendingInline.count) \(label) audio buffers never reached the video file\n", stderr)
			fflush(stderr)
		}
		if #available(macOS 15.0, *) {
			sidecar?.close()
		}
		sidecar = nil
		return sidecarError
	}

	private func limited(_ frames: Int64) -> Int64 {
		guard let limitFrame else { return frames }
		return min(frames, max(0, limitFrame - framesWritten))
	}

	private func writeSilence(frames: Int64) {
		var remaining = frames
		while remaining > 0 {
			let chunk = min(remaining, Self.silenceChunkFrames)
			guard let silence = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: AVAudioFrameCount(chunk)) else { return }
			silence.frameLength = AVAudioFrameCount(chunk)
			if let channels = silence.floatChannelData {
				for channel in 0..<Int(Self.format.channelCount) {
					channels[channel].update(repeating: 0, count: Int(chunk))
				}
			}
			write(silence)
			remaining -= chunk
		}
	}

	private func write(_ buffer: AVAudioPCMBuffer) {
		guard buffer.frameLength > 0 else { return }
		if let sidecar {
			do {
				try sidecar.write(from: buffer)
			} catch {
				fputs("Error: \(label) audio sidecar write failed: \(error.localizedDescription)\n", stderr)
				fflush(stderr)
				sidecarError = error
				self.sidecar = nil
			}
		}
		if inlineInput != nil {
			if !inlineWriterTakesData {
				// A failed, cancelled or finished writer never takes audio again, so hold none.
				pendingInline.removeAll()
			} else if let sampleBuffer = Self.makeSampleBuffer(from: buffer, at: endTime) {
				pendingInline.append(sampleBuffer)
				drainInline()
			}
		}
		framesWritten += Int64(buffer.frameLength)
	}

	/// The writer has not started yet or is writing. Every other state is final.
	private var inlineWriterTakesData: Bool {
		guard let status = inlineWriter?.status else { return false }
		return status == .unknown || status == .writing
	}

	private func drainInline() {
		// Appending to an input whose writer has failed raises an uncatchable
		// Objective-C exception, so check the writer before every batch.
		guard let inlineInput, inlineWriter?.status == .writing else { return }
		var appended = 0
		while appended < pendingInline.count, inlineInput.isReadyForMoreMediaData {
			guard inlineInput.append(pendingInline[appended]) else { break }
			appended += 1
		}
		if appended > 0 {
			pendingInline.removeFirst(appended)
		}
	}

	private func convert(_ source: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
		if source.format == Self.format {
			return source
		}
		// Microphone buffers arrive in the device's native format: often mono, sometimes
		// 16 or 24 kHz. Keep one converter so resampling carries state across buffers.
		if converter == nil || converter?.inputFormat != source.format {
			converter = AVAudioConverter(from: source.format, to: Self.format)
			if source.format.channelCount == 1 {
				converter?.channelMap = [0, 0]
			}
		}
		guard let converter else { return nil }
		let ratio = Self.sampleRate / source.format.sampleRate
		let capacity = AVAudioFrameCount((Double(source.frameLength) * ratio).rounded(.up)) + 64
		guard let output = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: capacity) else { return nil }
		var supplied = false
		var conversionError: NSError?
		let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
			if supplied {
				inputStatus.pointee = .noDataNow
				return nil
			}
			supplied = true
			inputStatus.pointee = .haveData
			return source
		}
		guard status != .error, conversionError == nil else { return nil }
		return output
	}

	private static func pcmBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
		guard let formatDescription = sampleBuffer.formatDescription,
			  formatDescription.mediaType == .audio else { return nil }
		let format = AVAudioFormat(cmAudioFormatDescription: formatDescription)
		let frameCount = AVAudioFrameCount(sampleBuffer.numSamples)
		guard frameCount > 0,
			  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return nil }
		buffer.frameLength = frameCount
		let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
			sampleBuffer,
			at: 0,
			frameCount: Int32(frameCount),
			into: buffer.mutableAudioBufferList
		)
		return status == noErr ? buffer : nil
	}

	private static func slice(_ buffer: AVAudioPCMBuffer, from offset: Int64, count: Int64) -> AVAudioPCMBuffer? {
		guard let source = buffer.floatChannelData,
			  let slice = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: AVAudioFrameCount(count)),
			  let destination = slice.floatChannelData else { return nil }
		slice.frameLength = AVAudioFrameCount(count)
		for channel in 0..<Int(buffer.format.channelCount) {
			destination[channel].update(from: source[channel].advanced(by: Int(offset)), count: Int(count))
		}
		return slice
	}

	/// Wraps PCM in a sample buffer that times every frame individually. Retiming an audio
	/// buffer with its total duration as the per-sample duration mislabels each frame.
	private static func makeSampleBuffer(from buffer: AVAudioPCMBuffer, at time: CMTime) -> CMSampleBuffer? {
		var timing = CMSampleTimingInfo(
			duration: CMTime(value: 1, timescale: CMTimeScale(sampleRate)),
			presentationTimeStamp: time,
			decodeTimeStamp: .invalid
		)
		var sampleBuffer: CMSampleBuffer?
		guard CMSampleBufferCreate(
			allocator: kCFAllocatorDefault,
			dataBuffer: nil,
			dataReady: false,
			makeDataReadyCallback: nil,
			refcon: nil,
			formatDescription: buffer.format.formatDescription,
			sampleCount: CMItemCount(buffer.frameLength),
			sampleTimingEntryCount: 1,
			sampleTimingArray: &timing,
			sampleSizeEntryCount: 0,
			sampleSizeArray: nil,
			sampleBufferOut: &sampleBuffer
		) == noErr,
			let sampleBuffer,
			CMSampleBufferSetDataBufferFromAudioBufferList(
				sampleBuffer,
				blockBufferAllocator: kCFAllocatorDefault,
				blockBufferMemoryAllocator: kCFAllocatorDefault,
				flags: 0,
				bufferList: buffer.audioBufferList
			) == noErr
		else { return nil }
		return sampleBuffer
	}
}

final class ScreenCaptureRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
	private struct CaptureFinalizationResult {
		let outputResult: Result<String, Error>
		let interactiveStopParticipated: Bool
	}

	private let queue = DispatchQueue(label: "recordly.screencapturekit.video")
	/// Audio never waits behind video work. A shared queue delivered audio in bursts the
	/// realtime writer refused.
	private let audioQueue = DispatchQueue(label: "recordly.screencapturekit.audio", qos: .userInteractive)
	private let clock = RecordingClock()
	private var assetWriter: AVAssetWriter?
	private var videoInput: AVAssetWriterInput?
	private var videoPixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
	private var windowCropRect: CGRect?
	private var windowCropDisplayId: CGDirectDisplayID?
	private var excludedProcessIds = Set<Int32>()
	private var lastCroppedPixelBuffer: CVPixelBuffer?
	private let imageContext = CIContext(options: [.cacheIntermediates: false])
	private var systemAudioTrack: AudioTimelineTrack?
	private var microphoneTrack: AudioTimelineTrack?
	private var stream: SCStream?
	private var stillFrameTimer: DispatchSourceTimer?
	private var lastSampleBuffer: CMSampleBuffer?
	private var lastVideoPresentationTime: CMTime = .zero
	private var lastVideoDuration: CMTime = .zero
	private var stopTimelineTime: CMTime?
	private var isRecording = false
	private var sessionStarted = false
	private var frameCount = 0
	private var outputURL: URL?
	private var trackedWindowId: UInt32?
	private var windowValidationTask: Task<Void, Never>?
	private var isFinalizing = false
	private var interactiveStopParticipated = false
	private var finalizationWaiters: [CheckedContinuation<CaptureFinalizationResult, Never>] = []
	private var inlineAudioInput: AVAssetWriterInput?
	private var capturesSystemAudio = false
	private var capturesMicrophone = false

	private let microphoneOutputTypeRawValue = 2

	func startCapture(configJSON: String) async throws {
		guard !isRecording else {
			throw NSError(domain: "RecordlyCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Recording is already in progress"])
		}

		guard let data = configJSON.data(using: .utf8) else {
			throw NSError(domain: "RecordlyCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid JSON input"])
		}

		let config = try JSONDecoder().decode(CaptureConfig.self, from: data)
		let availableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
		let streamConfig = SCStreamConfiguration()
		capturesSystemAudio = config.capturesSystemAudio ?? false
		capturesMicrophone = config.capturesMicrophone ?? false
		if capturesMicrophone && !supportsNativeMicrophoneCapture(streamConfig: streamConfig) {
			fputs("MICROPHONE_CAPTURE_UNAVAILABLE\n", stderr)
			fflush(stderr)
			capturesMicrophone = false
		}
		let requestedFPS = max(targetCaptureFPS, config.fps ?? targetCaptureFPS)
		streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(requestedFPS))
		streamConfig.queueDepth = 6
		streamConfig.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
		streamConfig.colorSpaceName = CGColorSpace.sRGB
		streamConfig.colorMatrix = CGDisplayStream.yCbCrMatrix_ITU_R_709_2
		streamConfig.showsCursor = false
		streamConfig.capturesAudio = capturesSystemAudio || capturesMicrophone
		streamConfig.sampleRate = 48000
		streamConfig.channelCount = 2
		streamConfig.excludesCurrentProcessAudio = true

		if capturesMicrophone {
			streamConfig.setValue(true, forKey: "captureMicrophone")
			if let microphoneDeviceId = Self.resolveMicrophoneCaptureDeviceID(config: config) {
				streamConfig.setValue(microphoneDeviceId, forKey: "microphoneCaptureDeviceID")
			}
		}

		let filter: SCContentFilter
		let outputWidth: Int
		let outputHeight: Int
		excludedProcessIds = Set(config.excludedProcessIds ?? [])
		let excludedApplications = availableContent.applications.filter {
			excludedProcessIds.contains($0.processID)
		}

		if let windowId = config.windowId {
			trackedWindowId = windowId
			guard let window = availableContent.windows.first(where: { $0.windowID == windowId }) else {
				throw NSError(domain: "RecordlyCapture", code: 3, userInfo: [NSLocalizedDescriptionKey: "Window not found"])
			}

			// Accessibility reports the visible frame at the native border.
			let visibleFrame: CGRect
			if let x = config.windowX,
			   let y = config.windowY,
			   let width = config.windowWidth,
			   let height = config.windowHeight,
			   width > 0,
			   height > 0 {
				visibleFrame = CGRect(x: x, y: y, width: width, height: height)
			} else {
				visibleFrame = window.frame
			}
			guard let display = Self.captureDisplay(for: visibleFrame, from: availableContent.displays) else {
				throw NSError(domain: "RecordlyCapture", code: 4, userInfo: [NSLocalizedDescriptionKey: "Window display not found"])
			}
			let scaleFactor = ScreenCaptureRecorder.scaleFactor(for: display.displayID)
			let captureRect = visibleFrame.intersection(display.frame)
			filter = SCContentFilter(
				display: display,
				excludingApplications: excludedApplications,
				exceptingWindows: []
			)
			windowCropRect = CGRect(
				x: (captureRect.minX - display.frame.minX) / display.frame.width,
				y: (captureRect.minY - display.frame.minY) / display.frame.height,
				width: captureRect.width / display.frame.width,
				height: captureRect.height / display.frame.height
			)
			windowCropDisplayId = display.displayID
			outputWidth = max(2, Int(captureRect.width) * scaleFactor) & ~1
			outputHeight = max(2, Int(captureRect.height) * scaleFactor) & ~1
			streamConfig.width = max(2, Int(display.frame.width) * scaleFactor)
			streamConfig.height = max(2, Int(display.frame.height) * scaleFactor)
			streamConfig.pixelFormat = kCVPixelFormatType_32BGRA
		} else {
			trackedWindowId = nil
			windowCropRect = nil
			windowCropDisplayId = nil
			let displayId = config.displayId ?? CGMainDisplayID()
			guard let display = availableContent.displays.first(where: { $0.displayID == displayId }) else {
				throw NSError(domain: "RecordlyCapture", code: 4, userInfo: [NSLocalizedDescriptionKey: "Display not found"])
			}

			filter = SCContentFilter(
				display: display,
				excludingApplications: excludedApplications,
				exceptingWindows: []
			)
			let displayBounds = CGDisplayBounds(display.displayID)
			let scaleFactor = ScreenCaptureRecorder.scaleFactor(for: display.displayID)
			outputWidth = max(2, Int(displayBounds.width) * scaleFactor)
			outputHeight = max(2, Int(displayBounds.height) * scaleFactor)
			streamConfig.width = outputWidth
			streamConfig.height = outputHeight
		}

		let destinationURL: URL
		if let outputPath = config.outputPath, !outputPath.isEmpty {
			destinationURL = URL(fileURLWithPath: outputPath)
		} else {
			destinationURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
				.appendingPathComponent("output_\(Int(Date().timeIntervalSince1970)).mp4")
		}

		outputURL = destinationURL
		let outputFileType: AVFileType = destinationURL.pathExtension.lowercased() == "mp4" ? .mp4 : .mov
		assetWriter = try AVAssetWriter(url: destinationURL, fileType: outputFileType)

		guard let assistant = AVOutputSettingsAssistant(preset: .preset3840x2160) else {
			throw NSError(domain: "RecordlyCapture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Unable to create output settings assistant"])
		}

		let sourceVideoFormat = try CMVideoFormatDescription(
			videoCodecType: CMFormatDescription.MediaSubType(
				rawValue: windowCropRect == nil
					? kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
					: kCVPixelFormatType_32BGRA
			),
			width: outputWidth,
			height: outputHeight
		)
		assistant.sourceVideoFormat = sourceVideoFormat

		guard var outputSettings = assistant.videoSettings else {
			throw NSError(domain: "RecordlyCapture", code: 6, userInfo: [NSLocalizedDescriptionKey: "Output settings unavailable"])
		}

		outputSettings[AVVideoWidthKey] = outputWidth
		outputSettings[AVVideoHeightKey] = outputHeight
		outputSettings[AVVideoColorPropertiesKey] = [
			AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
			AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
			AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
		]

		let videoInput = AVAssetWriterInput(
			mediaType: .video,
			outputSettings: outputSettings,
			sourceFormatHint: sourceVideoFormat
		)
		videoInput.expectsMediaDataInRealTime = true

		guard let assetWriter = assetWriter, assetWriter.canAdd(videoInput) else {
			throw NSError(domain: "RecordlyCapture", code: 7, userInfo: [NSLocalizedDescriptionKey: "Unable to add video writer input"])
		}

		assetWriter.add(videoInput)
		self.videoInput = videoInput
		videoPixelBufferAdaptor = windowCropRect.map { _ in
			AVAssetWriterInputPixelBufferAdaptor(
				assetWriterInput: videoInput,
				sourcePixelBufferAttributes: [
					kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
					kCVPixelBufferWidthKey as String: outputWidth,
					kCVPixelBufferHeightKey as String: outputHeight,
				]
			)
		}

		// Add inline audio track directly to the video so the .mp4 always contains audio.
		// This eliminates the dependency on the post-recording ffmpeg mux step.
		if capturesSystemAudio || capturesMicrophone {
			let inlineAudio = AVAssetWriterInput(mediaType: .audio, outputSettings: Self.audioOutputSettings(bitRate: 192_000))
			inlineAudio.expectsMediaDataInRealTime = true
			if assetWriter.canAdd(inlineAudio) {
				assetWriter.add(inlineAudio)
				self.inlineAudioInput = inlineAudio
			}
		}

		// The inline track carries system audio when it is captured and the microphone
		// otherwise. Each captured source also gets its own sidecar for the editor.
		if capturesSystemAudio {
			guard let systemAudioOutputPath = config.systemAudioOutputPath, !systemAudioOutputPath.isEmpty else {
				throw NSError(domain: "RecordlyCapture", code: 11, userInfo: [NSLocalizedDescriptionKey: "Missing system audio output path for audio capture"])
			}
			do {
				systemAudioTrack = try AudioTimelineTrack(
					label: "system",
					sidecarURL: URL(fileURLWithPath: systemAudioOutputPath),
					sidecarBitRate: 160_000,
					inlineInput: inlineAudioInput,
					inlineWriter: assetWriter
				)
			} catch {
				throw NSError(domain: "RecordlyCapture", code: 13, userInfo: [NSLocalizedDescriptionKey: "Unable to start system audio writing: \(error.localizedDescription)"])
			}
		}

		if capturesMicrophone {
			let microphoneURL = config.microphoneOutputPath.flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
			do {
				microphoneTrack = try AudioTimelineTrack(
					label: "microphone",
					sidecarURL: microphoneURL,
					sidecarBitRate: 128_000,
					inlineInput: capturesSystemAudio ? nil : inlineAudioInput,
					inlineWriter: assetWriter
				)
			} catch {
				throw NSError(domain: "RecordlyCapture", code: 16, userInfo: [NSLocalizedDescriptionKey: "Unable to start microphone audio writing: \(error.localizedDescription)"])
			}
		}

		let stream = SCStream(filter: filter, configuration: streamConfig, delegate: self)
		self.stream = stream
		try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
		if capturesSystemAudio {
			try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
		}
		if capturesMicrophone {
			guard let microphoneOutputType = SCStreamOutputType(rawValue: microphoneOutputTypeRawValue) else {
				throw NSError(
					domain: "RecordlyCapture",
					code: 17,
					userInfo: [NSLocalizedDescriptionKey: "Microphone stream output type is unavailable"]
				)
			}
			try stream.addStreamOutput(self, type: microphoneOutputType, sampleHandlerQueue: audioQueue)
		}
		try await stream.startCapture()

		guard assetWriter.startWriting() else {
			throw NSError(domain: "RecordlyCapture", code: 8, userInfo: [NSLocalizedDescriptionKey: assetWriter.error?.localizedDescription ?? "Unable to start video writing"])
		}

		assetWriter.startSession(atSourceTime: .zero)
		await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
			queue.async {
				self.clock.reset()
				self.stopTimelineTime = nil
				self.frameCount = 0
				self.lastVideoPresentationTime = .zero
				self.lastVideoDuration = .zero
				self.sessionStarted = true
				self.isRecording = true
				let stillFrameTimer = DispatchSource.makeTimerSource(queue: self.queue)
				stillFrameTimer.schedule(deadline: .now() + stillFrameInterval.seconds / 2, repeating: stillFrameInterval.seconds / 2)
				stillFrameTimer.setEventHandler { [weak self] in
					self?.appendStillFrameIfIdle()
				}
				stillFrameTimer.resume()
				self.stillFrameTimer = stillFrameTimer
				continuation.resume()
			}
		}
		startWindowValidationIfNeeded()
	}

	func stopCapture() async throws -> String {
		let finalization = await finalizeCapture(interactive: true)
		return try finalization.outputResult.get()
	}

	func pauseCapture() async -> Bool {
		await withCheckedContinuation { continuation in
			queue.async {
				guard self.isRecording else {
					continuation.resume(returning: false)
					return
				}
				self.clock.pause(atHostTime: RecordingClock.hostTime())
				continuation.resume(returning: true)
			}
		}
	}

	func resumeCapture() async -> Bool {
		await withCheckedContinuation { continuation in
			queue.async {
				guard self.isRecording else {
					continuation.resume(returning: false)
					return
				}
				self.clock.resume(atHostTime: RecordingClock.hostTime())
				continuation.resume(returning: true)
			}
		}
	}

	func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
		guard sampleBuffer.isValid else { return }

		if outputType == .screen {
			guard sessionStarted, isRecording else { return }
			guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
					  let attachment = attachments.first,
					  let statusRawValue = attachment[SCStreamFrameInfo.status] as? Int,
					  let status = SCFrameStatus(rawValue: statusRawValue),
					  status == .complete else {
				return
			}

			guard let videoInput = videoInput,
				  assetWriter?.status == .writing,
				  videoInput.isReadyForMoreMediaData else { return }

			// Only a complete frame that the writer can accept may establish time zero.
			guard let presentationTime = clock.videoTime(for: sampleBuffer.presentationTimeStamp) else { return }
			if frameCount > 0 && CMTimeCompare(presentationTime, lastVideoPresentationTime) <= 0 {
				return
			}

			let appended = appendVideoFrame(sampleBuffer, at: presentationTime, to: videoInput)
			if appended {
					lastVideoPresentationTime = presentationTime
					lastVideoDuration = sampleBuffer.duration
					frameCount += 1
					if frameCount == 1 {
						// Signal readiness only after AVAssetWriter has accepted a
						// real frame, so countdown warm-start cannot pause too early.
						print("Recording started")
						fflush(stdout)
					}
			} else if frameCount == 0 {
				// A failed crop/append must not leave an empty interval before frame one.
				clock.clearOrigin()
			}
			return
		}

		// Audio arrives on the audio queue. The clock rejects it while paused and until
		// the first video frame has set time zero; the tracks stop at the stop time.
		guard let presentationTime = clock.audioTime(for: sampleBuffer.presentationTimeStamp) else { return }
		if outputType == .audio {
			systemAudioTrack?.append(sampleBuffer, at: presentationTime)
		} else if outputType.rawValue == microphoneOutputTypeRawValue {
			microphoneTrack?.append(sampleBuffer, at: presentationTime)
		}
	}

	/// Appends one frame at its timeline time, cropped when recording a window.
	private func appendVideoFrame(_ sampleBuffer: CMSampleBuffer, at presentationTime: CMTime, to videoInput: AVAssetWriterInput) -> Bool {
		lastSampleBuffer = sampleBuffer
		if videoPixelBufferAdaptor != nil {
			return appendCroppedVideoFrame(sampleBuffer, at: presentationTime)
		}
		let timing = CMSampleTimingInfo(duration: sampleBuffer.duration, presentationTimeStamp: presentationTime, decodeTimeStamp: sampleBuffer.decodeTimeStamp)
		guard let retimed = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) else { return false }
		return videoInput.append(retimed)
	}

	/// Repeats the last frame while the screen is still. ScreenCaptureKit sends nothing
	/// for unchanged content and the writer does not stretch the last frame to the end
	/// of the session, so without this a still tail would end the video early and cut
	/// off the audio recorded over it. The repeat is stamped slightly in the past so a
	/// real frame that is still in flight stays newer than it. Runs on the video queue;
	/// the clock refuses while paused.
	private func appendStillFrameIfIdle() {
		guard isRecording,
			  frameCount > 0,
			  let lastSampleBuffer,
			  let videoInput,
			  assetWriter?.status == .writing,
			  videoInput.isReadyForMoreMediaData,
			  let now = clock.videoTime(for: RecordingClock.hostTime()) else { return }
		let repeatTime = now - stillFrameDeliveryAllowance
		guard CMTimeCompare(repeatTime - lastVideoPresentationTime, stillFrameInterval) >= 0,
			  appendVideoFrame(lastSampleBuffer, at: repeatTime, to: videoInput) else { return }
		lastVideoPresentationTime = repeatTime
		frameCount += 1
	}

	private func appendCroppedVideoFrame(_ sampleBuffer: CMSampleBuffer, at presentationTime: CMTime) -> Bool {
		guard let crop = windowCropRect,
			  let adaptor = videoPixelBufferAdaptor,
			  let pool = adaptor.pixelBufferPool,
			  let source = CMSampleBufferGetImageBuffer(sampleBuffer) else { return false }

		var destination: CVPixelBuffer?
		guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &destination) == kCVReturnSuccess,
			  let destination else { return false }

		let sourceWidth = CGFloat(CVPixelBufferGetWidth(source))
		let sourceHeight = CGFloat(CVPixelBufferGetHeight(source))
		let sourceRect = CGRect(
			x: crop.minX * sourceWidth,
			y: (1 - crop.maxY) * sourceHeight,
			width: crop.width * sourceWidth,
			height: crop.height * sourceHeight
		)
		let destinationSize = CGSize(
			width: CVPixelBufferGetWidth(destination),
			height: CVPixelBufferGetHeight(destination)
		)
		let image = CIImage(cvPixelBuffer: source)
			.cropped(to: sourceRect)
			.transformed(by: CGAffineTransform(translationX: -sourceRect.minX, y: -sourceRect.minY))
			.transformed(by: CGAffineTransform(
				scaleX: destinationSize.width / sourceRect.width,
				y: destinationSize.height / sourceRect.height
			))
		let bounds = CGRect(origin: .zero, size: destinationSize)
		imageContext.render(
			image,
			to: destination,
			bounds: bounds,
			colorSpace: CGColorSpace(name: CGColorSpace.sRGB)
		)

		let appended = adaptor.append(destination, withPresentationTime: presentationTime)
		if appended { lastCroppedPixelBuffer = destination }
		return appended
	}

	func stream(_ stream: SCStream, didStopWithError error: Error) {
		fputs("Error: \(error.localizedDescription)\n", stderr)
		fflush(stderr)
	}

	/// Starts one finalization operation after all previously delivered samples on
	/// the recorder queue have drained. Manual stop and automatic window-close
	/// detection join the same operation instead of racing the asset writers.
	private func finalizeCapture(interactive: Bool) async -> CaptureFinalizationResult {
		await withCheckedContinuation { continuation in
			queue.async {
				if self.isFinalizing {
					self.interactiveStopParticipated = self.interactiveStopParticipated || interactive
					self.finalizationWaiters.append(continuation)
					return
				}

				guard self.isRecording else {
					continuation.resume(returning: CaptureFinalizationResult(
						outputResult: .failure(NSError(
							domain: "RecordlyCapture",
							code: 9,
							userInfo: [NSLocalizedDescriptionKey: "No recording in progress"]
						)),
						interactiveStopParticipated: interactive
					))
					return
				}

				self.isFinalizing = true
				self.interactiveStopParticipated = interactive
				self.isRecording = false
				self.stillFrameTimer?.cancel()
				self.stillFrameTimer = nil
				self.windowValidationTask = nil
				self.trackedWindowId = nil
				self.finalizationWaiters.append(continuation)

				// The recording ends now. Audio captured before this moment that is still
				// in flight is kept; anything later is trimmed.
				let stopTime = self.clock.timelineTime(atHostTime: RecordingClock.hostTime())
				self.stopTimelineTime = stopTime
				if let stopTime {
					let stopFrame = Int64((stopTime.seconds * AudioTimelineTrack.sampleRate).rounded())
					self.audioQueue.async {
						self.systemAudioTrack?.limit(atFrame: stopFrame)
						self.microphoneTrack?.limit(atFrame: stopFrame)
					}
				}

				Task {
					let outputResult: Result<String, Error>
					do {
						outputResult = .success(try await self.finishCapture())
					} catch {
						outputResult = .failure(error)
					}

					self.queue.async {
						let finalizationResult = CaptureFinalizationResult(
							outputResult: outputResult,
							interactiveStopParticipated: self.interactiveStopParticipated
						)
						let waiters = self.finalizationWaiters
						self.finalizationWaiters.removeAll()
						self.isFinalizing = false
						self.interactiveStopParticipated = false
						for waiter in waiters {
							waiter.resume(returning: finalizationResult)
						}
					}
				}
			}
		}
	}

	private func finishCapture() async throws -> String {

		if let activeStream = stream {
			do {
				try await activeStream.stopCapture()
			} catch {
				// Stream may have already been stopped by the system — continue with file finalization
			}
		}
		stream = nil
		// Let audio callbacks that were already queued land, then detach the tracks so
		// a straggling callback cannot write while they close.
		let audioTracks = await withCheckedContinuation { (continuation: CheckedContinuation<[AudioTimelineTrack], Never>) in
			audioQueue.async {
				let tracks = [self.systemAudioTrack, self.microphoneTrack].compactMap { $0 }
				self.systemAudioTrack = nil
				self.microphoneTrack = nil
				continuation.resume(returning: tracks)
			}
		}

		// The recording runs until the stop even when the screen has been still since
		// the last frame, so the tail frame holds that frame up to the stop.
		let videoEndTime = lastVideoPresentationTime + (lastSampleBuffer.map { frameDuration(for: $0) } ?? .zero)
		let endTime = stopTimelineTime.map { max($0, videoEndTime) } ?? videoEndTime

		// The tail frame only gives the last captured frame its full duration, so
		// it must never put the file at risk.  Appending to an input whose encoder
		// queue is still backed up — routine after a long high-resolution capture —
		// raises an Objective-C exception that Swift cannot catch, aborting the
		// helper before `finishWriting()` and leaving an mdat with no moov atom:
		// an unplayable recording.  Wait briefly for the queue to drain, then skip
		// the frame rather than lose the recording.
		if let originalBuffer = lastSampleBuffer,
		   let videoInput = videoInput,
		   await waitUntilReady(videoInput, of: assetWriter) {
			let tailDuration = frameDuration(for: originalBuffer)
			let additionalTime = max(lastVideoPresentationTime + tailDuration, endTime - tailDuration)
			if let adaptor = videoPixelBufferAdaptor, let pixelBuffer = lastCroppedPixelBuffer {
				adaptor.append(pixelBuffer, withPresentationTime: additionalTime)
			} else {
				let timing = CMSampleTimingInfo(duration: tailDuration, presentationTimeStamp: additionalTime, decodeTimeStamp: originalBuffer.decodeTimeStamp)
				if let additionalSampleBuffer = try? CMSampleBuffer(copying: originalBuffer, withNewTiming: [timing]) {
				videoInput.append(additionalSampleBuffer)
				}
			}
		}

		// `endSession`, `markAsFinished` and `finishWriting` all raise when the
		// writer is no longer in the `.writing` state (a mid-capture failure, for
		// example a full disk), which would abort the helper the same way.

		// Every audio track is padded to the end of the recording, so the editor never
		// has to guess a start delay or stretch audio to fit the video.
		let endFrame = Int64((endTime.seconds * AudioTimelineTrack.sampleRate).rounded())
		var audioFailure: Error?
		for track in audioTracks {
			if let error = await track.finish(padTo: endFrame) {
				audioFailure = audioFailure ?? error
			}
		}

		if let assetWriter, assetWriter.status == .writing {
			assetWriter.endSession(atSourceTime: endTime)
			videoInput?.markAsFinished()
			inlineAudioInput?.markAsFinished()
			await assetWriter.finishWriting()
		}

		let finalizeFailure: Error? = [assetWriter]
			.compactMap { $0 }
			.compactMap { writer in
				writer.status == .completed
					? nil
					: (writer.error ?? unfinalizedWriterError(status: writer.status))
			}
			.first ?? audioFailure
		let path = outputURL?.path ?? ""
		assetWriter = nil
		videoInput = nil
		videoPixelBufferAdaptor = nil
		windowCropRect = nil
		windowCropDisplayId = nil
		excludedProcessIds.removeAll()
		lastCroppedPixelBuffer = nil
		inlineAudioInput = nil
		outputURL = nil
		sessionStarted = false
		clock.reset()
		stopTimelineTime = nil
		lastSampleBuffer = nil
		lastVideoPresentationTime = .zero
		lastVideoDuration = .zero
		frameCount = 0
		capturesSystemAudio = false
		capturesMicrophone = false

		// Report a half-written file as a failure instead of handing the editor a
		// path it cannot decode.
		if let finalizeFailure {
			throw finalizeFailure
		}

		return path
	}

	/// Waits briefly for an input's encoder queue to drain.  Returns false when the
	/// input stays backed up or its writer is no longer accepting data, in which
	/// case the caller must skip the append: `AVAssetWriterInput.append` raises an
	/// uncatchable Objective-C exception in both cases.
	private func waitUntilReady(_ input: AVAssetWriterInput, of writer: AVAssetWriter?) async -> Bool {
		guard let writer else { return false }

		var attemptsRemaining = writerReadinessPollAttempts
		while writer.status == .writing {
			if input.isReadyForMoreMediaData {
				return true
			}
			guard attemptsRemaining > 0 else { return false }
			attemptsRemaining -= 1
			do {
				try await Task.sleep(nanoseconds: writerReadinessPollInterval)
			} catch is CancellationError {
				return false
			} catch {
				return false
			}
		}

		return false
	}

	private func unfinalizedWriterError(status: AVAssetWriter.Status) -> Error {
		NSError(domain: "RecordlyCapture", code: 10, userInfo: [
			NSLocalizedDescriptionKey: "Recording could not be finalized (writer status \(status.rawValue))",
		])
	}

	private func frameDuration(for sampleBuffer: CMSampleBuffer) -> CMTime {
		if sampleBuffer.duration.isValid && sampleBuffer.duration > .zero {
			return sampleBuffer.duration
		}

		if lastVideoDuration.isValid && lastVideoDuration > .zero {
			return lastVideoDuration
		}

		return CMTime(value: 1, timescale: CMTimeScale(targetCaptureFPS))
	}

	private static func audioOutputSettings(bitRate: Int) -> [String: Any] {
		[
			AVFormatIDKey: kAudioFormatMPEG4AAC,
			AVSampleRateKey: 48_000,
			AVNumberOfChannelsKey: 2,
			AVEncoderBitRateKey: bitRate,
		]
	}

	private static func resolveMicrophoneCaptureDeviceID(config: CaptureConfig) -> String? {
		let audioDevices = AVCaptureDevice.devices(for: .audio)

		if let microphoneLabel = config.microphoneLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !microphoneLabel.isEmpty {
			if let matchedDevice = audioDevices.first(where: { $0.localizedName == microphoneLabel }) {
				return matchedDevice.uniqueID
			}
		}

		if let microphoneDeviceId = config.microphoneDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines), !microphoneDeviceId.isEmpty {
			if audioDevices.contains(where: { $0.uniqueID == microphoneDeviceId }) {
				return microphoneDeviceId
			}
		}

		return nil
	}

	private func supportsNativeMicrophoneCapture(streamConfig: SCStreamConfiguration) -> Bool {
		let supportsConfigSelector = streamConfig.responds(to: Selector(("setCaptureMicrophone:")))
		let supportsDeviceSelector = streamConfig.responds(to: Selector(("setMicrophoneCaptureDeviceID:")))
		let supportsOutputType = SCStreamOutputType(rawValue: microphoneOutputTypeRawValue) != nil
		return supportsConfigSelector && supportsDeviceSelector && supportsOutputType
	}

	private func startWindowValidationIfNeeded() {
		guard let trackedWindowId else {
			windowValidationTask?.cancel()
			windowValidationTask = nil
			return
		}

		windowValidationTask?.cancel()
		windowValidationTask = Task.detached(priority: .utility) { [weak self] in
			guard let self else { return }
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: 500_000_000)
				if Task.isCancelled { return }
				guard self.isRecording else { return }

				let availableContent: SCShareableContent
				do {
					availableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
				} catch {
					continue
				}

				guard let window = availableContent.windows.first(where: { $0.windowID == trackedWindowId }) else {
					print("WINDOW_UNAVAILABLE")
					fflush(stdout)
					let finalization = await self.finalizeCapture(interactive: false)
					if finalization.interactiveStopParticipated {
						return
					}
					do {
						let outputPath = try finalization.outputResult.get()
						print("Recording stopped. Output path: \(outputPath)")
						fflush(stdout)
						exit(0)
					} catch {
						fputs("Error stopping capture: \(error.localizedDescription)\n", stderr)
						fflush(stderr)
						exit(1)
					}
					return
				}

				guard let display = Self.captureDisplay(for: window.frame, from: availableContent.displays) else {
					continue
				}
				let captureRect = window.frame.intersection(display.frame)
				guard captureRect.width > 0, captureRect.height > 0 else { continue }
				let cropRect = CGRect(
					x: (captureRect.minX - display.frame.minX) / display.frame.width,
					y: (captureRect.minY - display.frame.minY) / display.frame.height,
					width: captureRect.width / display.frame.width,
					height: captureRect.height / display.frame.height
				)

				if self.windowCropDisplayId != display.displayID, let activeStream = self.stream {
					let excludedApplications = availableContent.applications.filter {
						self.excludedProcessIds.contains($0.processID)
					}
					let filter = SCContentFilter(
						display: display,
						excludingApplications: excludedApplications,
						exceptingWindows: []
					)
					do {
						try await activeStream.updateContentFilter(filter)
					} catch {
						continue
					}
				}

				await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
					self.queue.async {
						if self.isRecording {
							self.windowCropRect = cropRect
							self.windowCropDisplayId = display.displayID
						}
						continuation.resume()
					}
				}
			}
		}
	}

	private static func captureDisplay(for frame: CGRect, from displays: [SCDisplay]) -> SCDisplay? {
		let midpoint = CGPoint(x: frame.midX, y: frame.midY)
		return displays.first(where: { $0.frame.contains(midpoint) })
			?? displays.filter { $0.frame.intersects(frame) }.max {
				$0.frame.intersection(frame).width * $0.frame.intersection(frame).height
					< $1.frame.intersection(frame).width * $1.frame.intersection(frame).height
			}
	}

	private static func scaleFactor(for displayId: CGDirectDisplayID) -> Int {
		guard let mode = CGDisplayCopyDisplayMode(displayId) else {
			return 1
		}
		return max(1, mode.pixelWidth / max(1, mode.width))
	}
}

final class RecorderService {
	private let recorder = ScreenCaptureRecorder()
	private let queue = DispatchQueue(label: "recordly.screencapturekit.commands")
	private let completionGroup = DispatchGroup()
	private var succeeded = true
	// Accessed only by serialized command operations.
	private var captureStarted = false

	private func enqueue(_ operation: @escaping () async -> Void) {
		queue.async {
			let semaphore = DispatchSemaphore(value: 0)
			Task {
				await operation()
				semaphore.signal()
			}
			semaphore.wait()
		}
	}

	func start(configJSON: String) {
		completionGroup.enter()
		enqueue {
			do {
				try await self.recorder.startCapture(configJSON: configJSON)
				self.captureStarted = true
			} catch {
				self.succeeded = false
				fputs("Error starting capture: \(error.localizedDescription)\n", stderr)
				fflush(stderr)
				self.completionGroup.leave()
			}
		}
	}

	func stop() {
		enqueue {
			// Failed startup already releases completionGroup. EOF must not do it again.
			guard self.captureStarted else { return }
			self.captureStarted = false
			do {
				let outputPath = try await self.recorder.stopCapture()
				print("Recording stopped. Output path: \(outputPath)")
				fflush(stdout)
				self.completionGroup.leave()
			} catch {
				self.succeeded = false
				fputs("Error stopping capture: \(error.localizedDescription)\n", stderr)
				fflush(stderr)
				self.completionGroup.leave()
			}
		}
	}

	func pause() {
		enqueue {
			if await self.recorder.pauseCapture() {
				print("Recording paused")
				fflush(stdout)
			}
		}
	}

	func resume() {
		enqueue {
			if await self.recorder.resumeCapture() {
				print("Recording resumed")
				fflush(stdout)
			}
		}
	}

	func waitUntilFinished() -> Bool {
		completionGroup.wait()
		return succeeded
	}
}

guard CommandLine.arguments.count >= 2 else {
	fputs("Missing config JSON\n", stderr)
	fflush(stderr)
	exit(1)
}

// Force CoreGraphics Services initialization on the main thread.
// ScreenCaptureKit still requires CoreGraphics Services to be initialized in a CLI tool.
let _ = CGMainDisplayID()

// Pre-flight check: ensure screen recording permission is granted before
// attempting capture. On macOS 15+, a one-session grant may expire after the
// parent app restarts.  CGRequestScreenCaptureAccess() will trigger the
// system-level permission dialog (or open System Settings) when not yet granted.
if !CGPreflightScreenCaptureAccess() {
	let granted = CGRequestScreenCaptureAccess()
	if !granted {
		fputs("SCREEN_RECORDING_PERMISSION_DENIED\n", stderr)
		fflush(stderr)
		exit(1)
	}
}

// Pre-flight check for microphone access when mic capture is requested.
if let configData = CommandLine.arguments[1].data(using: .utf8),
   let config = try? JSONDecoder().decode(CaptureConfig.self, from: configData),
   config.capturesMicrophone == true {
	switch AVCaptureDevice.authorizationStatus(for: .audio) {
	case .authorized:
		break
	case .notDetermined:
		let sem = DispatchSemaphore(value: 0)
		AVCaptureDevice.requestAccess(for: .audio) { _ in sem.signal() }
		sem.wait()
		if AVCaptureDevice.authorizationStatus(for: .audio) != .authorized {
			fputs("MICROPHONE_PERMISSION_DENIED\n", stderr)
			fflush(stderr)
			exit(1)
		}
	default:
		fputs("MICROPHONE_PERMISSION_DENIED\n", stderr)
		fflush(stderr)
		exit(1)
	}
}

let service = RecorderService()
service.start(configJSON: CommandLine.arguments[1])

DispatchQueue.global(qos: .utility).async {
	while let input = readLine(strippingNewline: true)?.lowercased() {
		if input == "pause" {
			service.pause()
			continue
		}

		if input == "resume" {
			service.resume()
			continue
		}

		if input == "stop" {
			break
		}
	}
	// EOF means the Electron parent exited or restarted. Finalize and release
	// capture devices just as we do for an explicit stop command.
	service.stop()
}

if !service.waitUntilFinished() {
	exit(1)
}
