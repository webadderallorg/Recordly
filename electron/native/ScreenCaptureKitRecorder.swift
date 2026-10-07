import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreGraphics

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
let maxInlineAudioTailExtension = CMTime(seconds: 2.0, preferredTimescale: 600)
/// How long finalization waits for a backed-up encoder queue before giving up on
/// the optional tail frame: 100 polls x 10 ms = 1 s.
let writerReadinessPollAttempts = 100
let writerReadinessPollInterval: UInt64 = 10_000_000

final class ScreenCaptureRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
	private struct CaptureFinalizationResult {
		let outputResult: Result<String, Error>
		let interactiveStopParticipated: Bool
	}

	private let queue = DispatchQueue(label: "recordly.screencapturekit.video")
	private var assetWriter: AVAssetWriter?
	private var videoInput: AVAssetWriterInput?
	/// Window captures crop the display natively with `sourceRect`.
	private var streamConfiguration: SCStreamConfiguration?
	private var captureFrame: CGRect?
	private var captureDisplayId: CGDirectDisplayID?
	private var trackedWindowInitialFrame: CGRect?
	private var excludedProcessIds = Set<Int32>()
	private var systemAudioWriter: AVAssetWriter?
	private var systemAudioInput: AVAssetWriterInput?
	private var microphoneOnlyWriter: AVAssetWriter?
	private var microphoneOnlyInput: AVAssetWriterInput?
	private var stream: SCStream?
	private var pendingFirstFrame: CMSampleBuffer?
	private var firstSampleTime: CMTime = .zero
	private var firstSystemAudioSampleTime: CMTime?
	private var firstMicrophoneSampleTime: CMTime?
	private var lastSystemAudioPresentationTime: CMTime = .invalid
	private var lastMicrophonePresentationTime: CMTime = .invalid
	private var lastSampleBuffer: CMSampleBuffer?
	private var lastVideoPresentationTime: CMTime = .zero
	private var lastVideoDuration: CMTime = .zero
	private var lastInlineAudioPresentationTime: CMTime = .invalid
	private var lastInlineAudioDuration: CMTime = .zero
	private var isRecording = false
	private var isPaused = false
	private var pauseStartedHostTime: CMTime?
	private var pendingResumeAdjustment = false
	private var accumulatedPausedDuration: CMTime = .zero
	private var sessionStarted = false
	private var frameCount = 0
	private var outputURL: URL?
	private var microphoneOutputURL: URL?
	private var trackedWindowId: UInt32?
	private var windowValidationTask: Task<Void, Never>?
	private var isFinalizing = false
	private var interactiveStopParticipated = false
	private var finalizationWaiters: [CheckedContinuation<CaptureFinalizationResult, Never>] = []
	private var inlineAudioInput: AVAssetWriterInput?
	private var firstInlineAudioSampleTime: CMTime?
	private var capturesSystemAudio = false
	private var capturesMicrophone = false
	private var writesSystemAudioToSeparateTrack = false
	private var writesMicrophoneToSeparateTrack = false

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
		writesSystemAudioToSeparateTrack = capturesSystemAudio
		writesMicrophoneToSeparateTrack = capturesSystemAudio && capturesMicrophone
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
			// ScreenCaptureKit crops the display to the window natively, so menus and
			// popovers over the window are still captured as they appear on screen.
			let sourceRect = Self.sourceRect(for: captureRect, on: display, scale: scaleFactor)
			streamConfig.sourceRect = sourceRect
			trackedWindowInitialFrame = window.frame
			captureFrame = visibleFrame
			captureDisplayId = display.displayID
			outputWidth = Int((sourceRect.width * CGFloat(scaleFactor)).rounded())
			outputHeight = Int((sourceRect.height * CGFloat(scaleFactor)).rounded())
			streamConfig.width = outputWidth
			streamConfig.height = outputHeight
		} else {
			trackedWindowId = nil
			trackedWindowInitialFrame = nil
			captureFrame = nil
			captureDisplayId = nil
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
		streamConfiguration = streamConfig

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
		microphoneOutputURL = nil
		firstSystemAudioSampleTime = nil
		firstMicrophoneSampleTime = nil
		lastSystemAudioPresentationTime = .invalid
		lastMicrophonePresentationTime = .invalid

		guard let assistant = AVOutputSettingsAssistant(preset: .preset3840x2160) else {
			throw NSError(domain: "RecordlyCapture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Unable to create output settings assistant"])
		}

		let sourceVideoFormat = try CMVideoFormatDescription(
			videoCodecType: CMFormatDescription.MediaSubType(
				rawValue: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
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
		// The assistant sizes the bitrate for 30 fps. Scale it to the capture rate so
		// text stays sharp while the screen scrolls or animates.
		if var compression = outputSettings[AVVideoCompressionPropertiesKey] as? [String: Any] {
			let assistantFPS = max(1, compression[AVVideoExpectedSourceFrameRateKey] as? Int ?? 30)
			if let averageBitRate = compression[AVVideoAverageBitRateKey] as? Int {
				compression[AVVideoAverageBitRateKey] = averageBitRate * requestedFPS / assistantFPS
			}
			compression[AVVideoExpectedSourceFrameRateKey] = requestedFPS
			compression[AVVideoMaxKeyFrameIntervalKey] = requestedFPS
			outputSettings[AVVideoCompressionPropertiesKey] = compression
		}
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

		if writesSystemAudioToSeparateTrack {
			guard let systemAudioOutputPath = config.systemAudioOutputPath, !systemAudioOutputPath.isEmpty else {
				throw NSError(domain: "RecordlyCapture", code: 11, userInfo: [NSLocalizedDescriptionKey: "Missing system audio output path for audio capture"])
			}

			let systemAudioURL = URL(fileURLWithPath: systemAudioOutputPath)
			let systemAudioWriter = try AVAssetWriter(url: systemAudioURL, fileType: .m4a)
			let systemAudioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: Self.audioOutputSettings(bitRate: 160_000))
			systemAudioInput.expectsMediaDataInRealTime = true

			guard systemAudioWriter.canAdd(systemAudioInput) else {
				throw NSError(domain: "RecordlyCapture", code: 12, userInfo: [NSLocalizedDescriptionKey: "Unable to add system audio writer input"])
			}

			systemAudioWriter.add(systemAudioInput)
			self.systemAudioWriter = systemAudioWriter
			self.systemAudioInput = systemAudioInput

			guard systemAudioWriter.startWriting() else {
				throw NSError(domain: "RecordlyCapture", code: 13, userInfo: [NSLocalizedDescriptionKey: systemAudioWriter.error?.localizedDescription ?? "Unable to start system audio writing"])
			}

			systemAudioWriter.startSession(atSourceTime: .zero)
		}

		if writesMicrophoneToSeparateTrack {
			guard let microphoneOutputPath = config.microphoneOutputPath, !microphoneOutputPath.isEmpty else {
				throw NSError(domain: "RecordlyCapture", code: 14, userInfo: [NSLocalizedDescriptionKey: "Missing microphone output path for microphone capture"])
			}

			let microphoneURL = URL(fileURLWithPath: microphoneOutputPath)
			microphoneOutputURL = microphoneURL
			let microphoneWriter = try AVAssetWriter(url: microphoneURL, fileType: .m4a)
			let microphoneInput = AVAssetWriterInput(mediaType: .audio, outputSettings: Self.audioOutputSettings(bitRate: 128_000))
			microphoneInput.expectsMediaDataInRealTime = true

			guard microphoneWriter.canAdd(microphoneInput) else {
				throw NSError(domain: "RecordlyCapture", code: 15, userInfo: [NSLocalizedDescriptionKey: "Unable to add microphone writer input"])
			}

			microphoneWriter.add(microphoneInput)
			self.microphoneOnlyWriter = microphoneWriter
			self.microphoneOnlyInput = microphoneInput

			guard microphoneWriter.startWriting() else {
				throw NSError(domain: "RecordlyCapture", code: 16, userInfo: [NSLocalizedDescriptionKey: microphoneWriter.error?.localizedDescription ?? "Unable to start microphone audio writing"])
			}

			microphoneWriter.startSession(atSourceTime: .zero)
		}

		let stream = SCStream(filter: filter, configuration: streamConfig, delegate: self)
		self.stream = stream
		try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
		if capturesSystemAudio {
			try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
		}
		if capturesMicrophone {
			guard let microphoneOutputType = SCStreamOutputType(rawValue: microphoneOutputTypeRawValue) else {
				throw NSError(
					domain: "RecordlyCapture",
					code: 17,
					userInfo: [NSLocalizedDescriptionKey: "Microphone stream output type is unavailable"]
				)
			}
			try stream.addStreamOutput(self, type: microphoneOutputType, sampleHandlerQueue: queue)
		}
		try await stream.startCapture()

		guard assetWriter.startWriting() else {
			throw NSError(domain: "RecordlyCapture", code: 8, userInfo: [NSLocalizedDescriptionKey: assetWriter.error?.localizedDescription ?? "Unable to start video writing"])
		}

		assetWriter.startSession(atSourceTime: .zero)
		sessionStarted = true
		isRecording = true
		isPaused = false
		pauseStartedHostTime = nil
		pendingResumeAdjustment = false
		accumulatedPausedDuration = .zero
		frameCount = 0
		firstSampleTime = .zero
		lastVideoPresentationTime = .zero
		lastVideoDuration = .zero
		queue.async {
			self.appendPendingFirstFrame(attemptsRemaining: 100)
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
				guard self.isRecording, !self.isPaused else {
					continuation.resume(returning: self.isRecording && self.isPaused)
					return
				}
				self.isPaused = true
				self.pauseStartedHostTime = CMClockGetTime(CMClockGetHostTimeClock())
				self.pendingResumeAdjustment = false
				continuation.resume(returning: true)
			}
		}
	}

	func resumeCapture() async -> Bool {
		await withCheckedContinuation { continuation in
			queue.async {
				guard self.isRecording, self.isPaused else {
					continuation.resume(returning: self.isRecording && !self.isPaused)
					return
				}
				self.isPaused = false
				self.pendingResumeAdjustment = true
				continuation.resume(returning: true)
			}
		}
	}

	func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
		guard sampleBuffer.isValid else { return }

		if outputType == .screen {
			guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
					  let attachment = attachments.first,
					  let statusRawValue = attachment[SCStreamFrameInfo.status] as? Int,
					  let status = SCFrameStatus(rawValue: statusRawValue),
					  status == .complete else {
				return
			}

			guard sessionStarted, isRecording,
				  let videoInput = videoInput,
				  assetWriter?.status == .writing,
				  videoInput.isReadyForMoreMediaData else {
				// A still screen sends one complete frame and then nothing until it
				// changes, so keep the newest frame until the writer can take it.
				if frameCount == 0 && !isFinalizing {
					pendingFirstFrame = sampleBuffer
				}
				return
			}

			// Only a complete frame that the writer can accept may establish time zero.
			guard let presentationTime = adjustedPresentationTime(for: sampleBuffer.presentationTimeStamp, outputType: outputType) else { return }
			appendVideoFrame(sampleBuffer, at: presentationTime, to: videoInput)
			return
		}

		guard sessionStarted, isRecording else { return }
		guard frameCount > 0,
			  let presentationTime = adjustedPresentationTime(for: sampleBuffer.presentationTimeStamp, outputType: outputType) else { return }

		if outputType == .audio {
			guard let systemAudioInput else { return }
			appendAudioSampleBuffer(sampleBuffer, to: systemAudioInput, of: systemAudioWriter, firstSampleTime: &firstSystemAudioSampleTime, lastPresentationTime: &lastSystemAudioPresentationTime, presentationTime: presentationTime)
			// Also write system audio to the inline video track
			if let inlineAudioInput, inlineAudioInput.isReadyForMoreMediaData {
				appendAudioSampleBuffer(sampleBuffer, to: inlineAudioInput, of: assetWriter, firstSampleTime: &firstInlineAudioSampleTime, lastPresentationTime: &lastInlineAudioPresentationTime, presentationTime: presentationTime)
			}
			return
		}

		if outputType.rawValue == microphoneOutputTypeRawValue {
			if let microphoneOnlyInput {
				appendAudioSampleBuffer(sampleBuffer, to: microphoneOnlyInput, of: microphoneOnlyWriter, firstSampleTime: &firstMicrophoneSampleTime, lastPresentationTime: &lastMicrophonePresentationTime, presentationTime: presentationTime)
			}
			// Write mic to inline video track only if there's no system audio (avoids double-writing)
			if !capturesSystemAudio, let inlineAudioInput, inlineAudioInput.isReadyForMoreMediaData {
				appendAudioSampleBuffer(sampleBuffer, to: inlineAudioInput, of: assetWriter, firstSampleTime: &firstInlineAudioSampleTime, lastPresentationTime: &lastInlineAudioPresentationTime, presentationTime: presentationTime)
			}
			return
		}

		return
	}

	/// Appends one complete frame at its timeline time. Runs on the video queue.
	private func appendVideoFrame(_ sampleBuffer: CMSampleBuffer, at presentationTime: CMTime, to videoInput: AVAssetWriterInput) {
		if frameCount > 0 && CMTimeCompare(presentationTime, lastVideoPresentationTime) <= 0 {
			return
		}

		lastSampleBuffer = sampleBuffer
		let timing = CMSampleTimingInfo(duration: sampleBuffer.duration, presentationTimeStamp: presentationTime, decodeTimeStamp: sampleBuffer.decodeTimeStamp)
		let appended: Bool
		if let retimed = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) {
			appended = videoInput.append(retimed)
		} else {
			appended = false
		}
		if appended {
			pendingFirstFrame = nil
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
			// A failed append must not leave an empty interval before frame one.
			firstSampleTime = .zero
		}
	}

	/// Writes the frame that arrived before the writer was ready, so recording a still
	/// window starts without waiting for something on screen to change. The frame shows
	/// the screen as it is now, so it starts the timeline now. Runs on the video queue
	/// and retries until the writer accepts a frame.
	private func appendPendingFirstFrame(attemptsRemaining: Int) {
		guard isRecording, frameCount == 0 else { return }
		if let pendingFirstFrame,
		   let videoInput,
		   assetWriter?.status == .writing,
		   videoInput.isReadyForMoreMediaData,
		   let presentationTime = adjustedPresentationTime(for: CMClockGetTime(CMClockGetHostTimeClock()), outputType: .screen) {
			appendVideoFrame(pendingFirstFrame, at: presentationTime, to: videoInput)
		}
		guard frameCount == 0, attemptsRemaining > 0 else { return }
		queue.asyncAfter(deadline: .now() + .milliseconds(50)) {
			self.appendPendingFirstFrame(attemptsRemaining: attemptsRemaining - 1)
		}
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
				self.windowValidationTask = nil
				self.trackedWindowId = nil
				self.finalizationWaiters.append(continuation)

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
			let additionalTime = lastVideoPresentationTime + frameDuration(for: originalBuffer)
			let timing = CMSampleTimingInfo(duration: originalBuffer.duration, presentationTimeStamp: additionalTime, decodeTimeStamp: originalBuffer.decodeTimeStamp)
			if let additionalSampleBuffer = try? CMSampleBuffer(copying: originalBuffer, withNewTiming: [timing]) {
				videoInput.append(additionalSampleBuffer)
			}
		}

		// `endSession`, `markAsFinished` and `finishWriting` all raise when the
		// writer is no longer in the `.writing` state (a mid-capture failure, for
		// example a full disk), which would abort the helper the same way.
		let videoEndTime = lastVideoPresentationTime + (lastSampleBuffer.map { frameDuration(for: $0) } ?? .zero)
		let endTime = resolvedCaptureEndTime(videoEndTime: videoEndTime)
		if let assetWriter, assetWriter.status == .writing {
			assetWriter.endSession(atSourceTime: endTime)
			videoInput?.markAsFinished()
			inlineAudioInput?.markAsFinished()
			await assetWriter.finishWriting()
		}

		if let systemAudioWriter, systemAudioWriter.status == .writing {
			systemAudioInput?.markAsFinished()
			await systemAudioWriter.finishWriting()
		}

		if let microphoneOnlyWriter, microphoneOnlyWriter.status == .writing {
			microphoneOnlyInput?.markAsFinished()
			await microphoneOnlyWriter.finishWriting()
		}

		let finalizeFailure: Error? = [assetWriter, systemAudioWriter, microphoneOnlyWriter]
			.compactMap { $0 }
			.compactMap { writer in
				writer.status == .completed
					? nil
					: (writer.error ?? unfinalizedWriterError(status: writer.status))
			}
			.first
		let path = outputURL?.path ?? ""
		assetWriter = nil
		videoInput = nil
		streamConfiguration = nil
		captureFrame = nil
		captureDisplayId = nil
		trackedWindowInitialFrame = nil
		pendingFirstFrame = nil
		excludedProcessIds.removeAll()
		systemAudioWriter = nil
		systemAudioInput = nil
		microphoneOnlyWriter = nil
		microphoneOnlyInput = nil
		inlineAudioInput = nil
		outputURL = nil
		microphoneOutputURL = nil
		sessionStarted = false
		firstSampleTime = .zero
		firstSystemAudioSampleTime = nil
		firstMicrophoneSampleTime = nil
		lastSystemAudioPresentationTime = .invalid
		lastMicrophonePresentationTime = .invalid
		firstInlineAudioSampleTime = nil
		lastSampleBuffer = nil
		lastVideoPresentationTime = .zero
		lastVideoDuration = .zero
		lastInlineAudioPresentationTime = .invalid
		lastInlineAudioDuration = .zero
		frameCount = 0
		isPaused = false
		pauseStartedHostTime = nil
		pendingResumeAdjustment = false
		accumulatedPausedDuration = .zero
		capturesSystemAudio = false
		capturesMicrophone = false
		writesSystemAudioToSeparateTrack = false
		writesMicrophoneToSeparateTrack = false

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

	private func adjustedPresentationTime(for sampleTime: CMTime, outputType: SCStreamOutputType) -> CMTime? {
		if isPaused {
			return nil
		}

		if pendingResumeAdjustment {
			// Audio and video callbacks share this queue but their timestamps can be
			// offset slightly. Anchor the post-countdown adjustment to video and drop
			// audio until that anchor exists; otherwise the first audio callback can
			// make the following video timestamp move backwards and fail the writer.
			guard outputType == .screen, let pauseStartedHostTime else {
				return nil
			}
			let pauseGap = sampleTime - pauseStartedHostTime
			if pauseGap > .zero {
				accumulatedPausedDuration = accumulatedPausedDuration + pauseGap
			}
			self.pauseStartedHostTime = nil
			pendingResumeAdjustment = false
		}

		if outputType == .screen {
			if firstSampleTime == .zero {
				firstSampleTime = sampleTime
			}
		}

		// Use video's first sample time as the common time base for ALL tracks.
		// This ensures audio files contain leading silence when audio hardware
		// delivers its first sample after the first video frame (e.g. iPhone mic
		// over Continuity Camera can lag 1-2 seconds behind).
		if firstSampleTime == .zero {
			// Video hasn't started yet — drop this audio sample to avoid
			// negative timestamps.
			return nil
		}

		return max(.zero, sampleTime - firstSampleTime - accumulatedPausedDuration)
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

	private func latestInlineAudioEndTime() -> CMTime {
		guard lastInlineAudioPresentationTime.isValid else {
			return .invalid
		}

		if lastInlineAudioDuration.isValid && lastInlineAudioDuration > .zero {
			return lastInlineAudioPresentationTime + lastInlineAudioDuration
		}

		return lastInlineAudioPresentationTime
	}

	private func resolvedCaptureEndTime(videoEndTime: CMTime) -> CMTime {
		let inlineAudioEndTime = latestInlineAudioEndTime()
		guard inlineAudioEndTime.isValid else {
			return videoEndTime
		}

		if CMTimeCompare(inlineAudioEndTime, videoEndTime) <= 0 {
			return videoEndTime
		}

		// Prevent a stray inline-audio timestamp from forcing finishWriting
		// to finalize an arbitrarily long tail.
		let tailExtension = CMTimeSubtract(inlineAudioEndTime, videoEndTime)
		return videoEndTime + CMTimeMinimum(tailExtension, maxInlineAudioTailExtension)
	}

	private func appendAudioSampleBuffer(_ sampleBuffer: CMSampleBuffer, to input: AVAssetWriterInput, of writer: AVAssetWriter?, firstSampleTime: inout CMTime?, lastPresentationTime: inout CMTime, presentationTime: CMTime) {
		// A writer that failed mid-capture (a full disk, say) raises on every
		// further append, which would abort the helper and lose the whole file.
		guard writer?.status == .writing, input.isReadyForMoreMediaData else { return }
		guard !lastPresentationTime.isValid || CMTimeCompare(presentationTime, lastPresentationTime) > 0 else { return }

		if firstSampleTime == nil {
			firstSampleTime = presentationTime
		}

		// presentationTime is already relative to the video's first frame
		// (computed by adjustedPresentationTime), so use it directly.
		let timing = CMSampleTimingInfo(duration: sampleBuffer.duration, presentationTimeStamp: presentationTime, decodeTimeStamp: sampleBuffer.decodeTimeStamp)
		if let retimedSampleBuffer = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) {
			let appended = input.append(retimedSampleBuffer)
			if appended {
				lastPresentationTime = presentationTime
				if input === inlineAudioInput {
					lastInlineAudioDuration = sampleBuffer.duration
				}
			}
		}
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

	/// Follows the recorded window as it moves, resizes or changes display. The crop
	/// keeps the accessibility inset measured at start by moving with the window frame.
	private func startWindowValidationIfNeeded() {
		guard let trackedWindowId,
			  let initialWindowFrame = trackedWindowInitialFrame,
			  let initialCaptureFrame = captureFrame,
			  let initialDisplayId = captureDisplayId,
			  let streamConfiguration else {
			windowValidationTask?.cancel()
			windowValidationTask = nil
			return
		}

		windowValidationTask?.cancel()
		windowValidationTask = Task.detached(priority: .utility) { [weak self] in
			var currentDisplayId = initialDisplayId
			var currentSourceRect = streamConfiguration.sourceRect
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: 500_000_000)
				if Task.isCancelled { return }
				guard let self, self.isRecording else { return }

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

				let frame = CGRect(
					x: initialCaptureFrame.minX + (window.frame.minX - initialWindowFrame.minX),
					y: initialCaptureFrame.minY + (window.frame.minY - initialWindowFrame.minY),
					width: max(2, initialCaptureFrame.width + (window.frame.width - initialWindowFrame.width)),
					height: max(2, initialCaptureFrame.height + (window.frame.height - initialWindowFrame.height))
				)
				guard let display = Self.captureDisplay(for: window.frame, from: availableContent.displays) else {
					continue
				}
				let captureRect = frame.intersection(display.frame)
				guard captureRect.width > 0, captureRect.height > 0, let activeStream = self.stream else { continue }
				let sourceRect = Self.sourceRect(
					for: captureRect,
					on: display,
					scale: Self.scaleFactor(for: display.displayID)
				)

				if currentDisplayId != display.displayID {
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
						currentDisplayId = display.displayID
					} catch {
						continue
					}
				}

				if !Self.rect(sourceRect, isCloseTo: currentSourceRect) {
					streamConfiguration.sourceRect = sourceRect
					do {
						try await activeStream.updateConfiguration(streamConfiguration)
						currentSourceRect = sourceRect
					} catch {
						continue
					}
				}
			}
		}
	}

	/// `sourceRect` is in points relative to the display's top-left corner. Its edges
	/// sit on whole pixels and its size is an even number of pixels, so the recording
	/// gets the screen's own pixels instead of a resampled copy.
	private static func sourceRect(for captureRect: CGRect, on display: SCDisplay, scale: Int) -> CGRect {
		let pixelsPerPoint = CGFloat(scale)
		let local = captureRect.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
		let left = (local.minX * pixelsPerPoint).rounded()
		let top = (local.minY * pixelsPerPoint).rounded()
		let width = max(2, Int((local.maxX * pixelsPerPoint).rounded() - left) & ~1)
		let height = max(2, Int((local.maxY * pixelsPerPoint).rounded() - top) & ~1)
		return CGRect(
			x: left / pixelsPerPoint,
			y: top / pixelsPerPoint,
			width: CGFloat(width) / pixelsPerPoint,
			height: CGFloat(height) / pixelsPerPoint
		)
	}

	private static func rect(_ lhs: CGRect, isCloseTo rhs: CGRect) -> Bool {
		abs(lhs.minX - rhs.minX) < 0.5 && abs(lhs.minY - rhs.minY) < 0.5
			&& abs(lhs.width - rhs.width) < 0.5 && abs(lhs.height - rhs.height) < 0.5
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
