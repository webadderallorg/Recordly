import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreGraphics

struct CaptureConfig: Codable {
	let fps: Int?
	let displayId: CGDirectDisplayID?
	let windowId: UInt32?
	let outputPath: String?
	let capturesSystemAudio: Bool?
	let capturesMicrophone: Bool?
	let systemAudioOutputPath: String?
	let microphoneDeviceId: String?
	let microphoneLabel: String?
	let microphoneOutputPath: String?
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
	private var systemAudioWriter: AVAssetWriter?
	private var systemAudioInput: AVAssetWriterInput?
	private var microphoneOnlyWriter: AVAssetWriter?
	private var microphoneOnlyInput: AVAssetWriterInput?
	private var stream: SCStream?
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
		streamConfig.pixelFormat = kCVPixelFormatType_32BGRA
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

		if let windowId = config.windowId {
			trackedWindowId = windowId
			guard let window = availableContent.windows.first(where: { $0.windowID == windowId }) else {
				throw NSError(domain: "RecordlyCapture", code: 3, userInfo: [NSLocalizedDescriptionKey: "Window not found"])
			}

			let candidateDisplay = availableContent.displays.first(where: {
				$0.frame.intersects(window.frame) || $0.frame.contains(CGPoint(x: window.frame.midX, y: window.frame.midY))
			})

			guard let display = candidateDisplay else {
				throw NSError(domain: "RecordlyCapture", code: 4, userInfo: [NSLocalizedDescriptionKey: "No intersecting display found for window"])
			}

			filter = SCContentFilter(display: display, including: [window], exceptingApplications: [], exceptingWindows: [])

			let scaleFactor = ScreenCaptureRecorder.scaleFactor(for: display.displayID)
			outputWidth = max(2, Int(window.frame.width) * scaleFactor)
			outputHeight = max(2, Int(window.frame.height) * scaleFactor)
			if #available(macOS 14.0, *) {
				streamConfig.ignoreShadowsSingleWindow = true
			}
			streamConfig.width = outputWidth
			streamConfig.height = outputHeight
		} else {
			trackedWindowId = nil
			let displayId = config.displayId ?? CGMainDisplayID()
			guard let display = availableContent.displays.first(where: { $0.displayID == displayId }) else {
				throw NSError(domain: "RecordlyCapture", code: 4, userInfo: [NSLocalizedDescriptionKey: "Display not found"])
			}

			filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
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
		microphoneOutputURL = nil
		firstSystemAudioSampleTime = nil
		firstMicrophoneSampleTime = nil
		lastSystemAudioPresentationTime = .invalid
		lastMicrophonePresentationTime = .invalid

		guard let assistant = AVOutputSettingsAssistant(preset: .preset3840x2160) else {
			throw NSError(domain: "RecordlyCapture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Unable to create output settings assistant"])
		}

		assistant.sourceVideoFormat = try CMVideoFormatDescription(
			videoCodecType: .h264,
			width: outputWidth,
			height: outputHeight
		)

		guard var outputSettings = assistant.videoSettings else {
			throw NSError(domain: "RecordlyCapture", code: 6, userInfo: [NSLocalizedDescriptionKey: "Output settings unavailable"])
		}

		outputSettings[AVVideoWidthKey] = outputWidth
		outputSettings[AVVideoHeightKey] = outputHeight

		let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: outputSettings)
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
		guard sessionStarted, sampleBuffer.isValid, isRecording else { return }
		guard let presentationTime = adjustedPresentationTime(for: sampleBuffer, outputType: outputType) else { return }

		if outputType == .screen {
			if frameCount > 0 && CMTimeCompare(presentationTime, lastVideoPresentationTime) <= 0 {
				return
			}

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

			if firstSampleTime == .zero {
				firstSampleTime = sampleBuffer.presentationTimeStamp
			}

			lastSampleBuffer = sampleBuffer
			let timing = CMSampleTimingInfo(duration: sampleBuffer.duration, presentationTimeStamp: presentationTime, decodeTimeStamp: sampleBuffer.decodeTimeStamp)
			if let retimedSampleBuffer = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) {
				if videoInput.append(retimedSampleBuffer) {
					lastVideoPresentationTime = presentationTime
					lastVideoDuration = sampleBuffer.duration
					frameCount += 1
					if frameCount == 1 {
						// Signal readiness only after AVAssetWriter has accepted a
						// real frame, so countdown warm-start cannot pause too early.
						print("Recording started")
						fflush(stdout)
					}
				}
			}
			return
		}

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

	private func adjustedPresentationTime(for sampleBuffer: CMSampleBuffer, outputType: SCStreamOutputType) -> CMTime? {
		if isPaused {
			return nil
		}

		let sampleTime = sampleBuffer.presentationTimeStamp
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

				let windowStillAvailable = availableContent.windows.contains(where: { $0.windowID == trackedWindowId })
				if !windowStillAvailable {
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
				}
			}
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
// Without this, CoreGraphics operations may fail with CGS_REQUIRE_INIT
// because CGS is never initialised in a CLI tool.
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
			service.stop()
			break
		}
	}
}

if !service.waitUntilFinished() {
	exit(1)
}
