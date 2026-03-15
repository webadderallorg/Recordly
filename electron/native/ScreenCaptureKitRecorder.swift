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
	let microphoneDeviceId: String?
	let microphoneOutputPath: String?
}

let targetCaptureFPS = 60

final class ScreenCaptureRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
	private let queue = DispatchQueue(label: "openscreen.screencapturekit.video")
	private var assetWriter: AVAssetWriter?
	private var videoInput: AVAssetWriterInput?
	private var audioInput: AVAssetWriterInput?
	private var microphoneOnlyWriter: AVAssetWriter?
	private var microphoneOnlyInput: AVAssetWriterInput?
	private var stream: SCStream?
	private var firstSampleTime: CMTime = .zero
	private var firstPrimaryAudioSampleTime: CMTime?
	private var firstMicrophoneSampleTime: CMTime?
	private var lastSampleBuffer: CMSampleBuffer?
	private var isRecording = false
	private var sessionStarted = false
	private var frameCount = 0
	private var outputURL: URL?
	private var microphoneOutputURL: URL?
	private var trackedWindowId: UInt32?
	private var windowValidationTask: Task<Void, Never>?
	private var capturesSystemAudio = false
	private var capturesMicrophone = false
	private var writesMicrophoneToSeparateTrack = false

	private enum PrimaryAudioSource {
		case system
		case microphone
	}

	private let microphoneOutputTypeRawValue = 2

	private var primaryAudioSource: PrimaryAudioSource?

	func startCapture(configJSON: String) async throws {
		guard !isRecording else {
			throw NSError(domain: "OpenRecorderCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Recording is already in progress"])
		}

		guard let data = configJSON.data(using: .utf8) else {
			throw NSError(domain: "OpenRecorderCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid JSON input"])
		}

		let config = try JSONDecoder().decode(CaptureConfig.self, from: data)
		let availableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
		let streamConfig = SCStreamConfiguration()
		capturesSystemAudio = config.capturesSystemAudio ?? false
		capturesMicrophone = config.capturesMicrophone ?? false
		if capturesMicrophone && !supportsNativeMicrophoneCapture(streamConfig: streamConfig) {
			throw NSError(
				domain: "OpenRecorderCapture",
				code: 10,
				userInfo: [NSLocalizedDescriptionKey: "Native microphone capture is unavailable on this macOS/Xcode runtime"]
			)
		}
		writesMicrophoneToSeparateTrack = capturesSystemAudio && capturesMicrophone
		primaryAudioSource = capturesSystemAudio ? .system : (capturesMicrophone ? .microphone : nil)
		let requestedFPS = max(targetCaptureFPS, config.fps ?? targetCaptureFPS)
		streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(requestedFPS))
		streamConfig.queueDepth = 6
		streamConfig.pixelFormat = kCVPixelFormatType_32BGRA
		streamConfig.showsCursor = false
		streamConfig.capturesAudio = capturesSystemAudio
		streamConfig.sampleRate = 48000
		streamConfig.channelCount = 2
		streamConfig.excludesCurrentProcessAudio = true

		if capturesMicrophone {
			streamConfig.setValue(true, forKey: "captureMicrophone")
			if let microphoneDeviceId = config.microphoneDeviceId, !microphoneDeviceId.isEmpty {
				streamConfig.setValue(microphoneDeviceId, forKey: "microphoneCaptureDeviceID")
			}
		}

		let filter: SCContentFilter
		let outputWidth: Int
		let outputHeight: Int

		if let windowId = config.windowId {
			trackedWindowId = windowId
			guard let window = availableContent.windows.first(where: { $0.windowID == windowId }) else {
				throw NSError(domain: "OpenRecorderCapture", code: 3, userInfo: [NSLocalizedDescriptionKey: "Window not found"])
			}

			filter = SCContentFilter(desktopIndependentWindow: window)

			let candidateDisplay = availableContent.displays.first(where: {
				$0.frame.intersects(window.frame) || $0.frame.contains(CGPoint(x: window.frame.midX, y: window.frame.midY))
			})
			let scaleFactor = ScreenCaptureRecorder.scaleFactor(for: candidateDisplay?.displayID ?? CGMainDisplayID())
			outputWidth = max(2, Int(window.frame.width) * scaleFactor)
			outputHeight = max(2, Int(window.frame.height) * scaleFactor)
			streamConfig.ignoreShadowsSingleWindow = true
			streamConfig.width = outputWidth
			streamConfig.height = outputHeight
		} else {
			trackedWindowId = nil
			let displayId = config.displayId ?? CGMainDisplayID()
			guard let display = availableContent.displays.first(where: { $0.displayID == displayId }) else {
				throw NSError(domain: "OpenRecorderCapture", code: 4, userInfo: [NSLocalizedDescriptionKey: "Display not found"])
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
		firstPrimaryAudioSampleTime = nil
		firstMicrophoneSampleTime = nil

		guard let assistant = AVOutputSettingsAssistant(preset: .preset3840x2160) else {
			throw NSError(domain: "OpenRecorderCapture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Unable to create output settings assistant"])
		}

		assistant.sourceVideoFormat = try CMVideoFormatDescription(
			videoCodecType: .h264,
			width: outputWidth,
			height: outputHeight
		)

		guard var outputSettings = assistant.videoSettings else {
			throw NSError(domain: "OpenRecorderCapture", code: 6, userInfo: [NSLocalizedDescriptionKey: "Output settings unavailable"])
		}

		outputSettings[AVVideoWidthKey] = outputWidth
		outputSettings[AVVideoHeightKey] = outputHeight

		let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: outputSettings)
		videoInput.expectsMediaDataInRealTime = true

		guard let assetWriter = assetWriter, assetWriter.canAdd(videoInput) else {
			throw NSError(domain: "OpenRecorderCapture", code: 7, userInfo: [NSLocalizedDescriptionKey: "Unable to add video writer input"])
		}

		assetWriter.add(videoInput)
		self.videoInput = videoInput

		if primaryAudioSource != nil {
			let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: Self.audioOutputSettings(bitRate: 160_000))
			audioInput.expectsMediaDataInRealTime = true

			guard assetWriter.canAdd(audioInput) else {
				throw NSError(domain: "OpenRecorderCapture", code: 11, userInfo: [NSLocalizedDescriptionKey: "Unable to add audio writer input"])
			}

			assetWriter.add(audioInput)
			self.audioInput = audioInput
		}

		if writesMicrophoneToSeparateTrack {
			guard let microphoneOutputPath = config.microphoneOutputPath, !microphoneOutputPath.isEmpty else {
				throw NSError(domain: "OpenRecorderCapture", code: 12, userInfo: [NSLocalizedDescriptionKey: "Missing microphone output path for dual-audio capture"])
			}

			let microphoneURL = URL(fileURLWithPath: microphoneOutputPath)
			microphoneOutputURL = microphoneURL
			let microphoneWriter = try AVAssetWriter(url: microphoneURL, fileType: .m4a)
			let microphoneInput = AVAssetWriterInput(mediaType: .audio, outputSettings: Self.audioOutputSettings(bitRate: 128_000))
			microphoneInput.expectsMediaDataInRealTime = true

			guard microphoneWriter.canAdd(microphoneInput) else {
				throw NSError(domain: "OpenRecorderCapture", code: 13, userInfo: [NSLocalizedDescriptionKey: "Unable to add microphone writer input"])
			}

			microphoneWriter.add(microphoneInput)
			self.microphoneOnlyWriter = microphoneWriter
			self.microphoneOnlyInput = microphoneInput

			guard microphoneWriter.startWriting() else {
				throw NSError(domain: "OpenRecorderCapture", code: 14, userInfo: [NSLocalizedDescriptionKey: microphoneWriter.error?.localizedDescription ?? "Unable to start microphone audio writing"])
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
					domain: "OpenRecorderCapture",
					code: 15,
					userInfo: [NSLocalizedDescriptionKey: "Microphone stream output type is unavailable"]
				)
			}
			try stream.addStreamOutput(self, type: microphoneOutputType, sampleHandlerQueue: queue)
		}
		try await stream.startCapture()

		guard assetWriter.startWriting() else {
			throw NSError(domain: "OpenRecorderCapture", code: 8, userInfo: [NSLocalizedDescriptionKey: assetWriter.error?.localizedDescription ?? "Unable to start video writing"])
		}

		assetWriter.startSession(atSourceTime: .zero)
		sessionStarted = true
		isRecording = true
		frameCount = 0
		firstSampleTime = .zero
		startWindowValidationIfNeeded()
		print("Recording started")
		fflush(stdout)
	}

	func stopCapture() async throws -> String {
		guard isRecording else {
			throw NSError(domain: "OpenRecorderCapture", code: 9, userInfo: [NSLocalizedDescriptionKey: "No recording in progress"])
		}

		return try await finishCapture()
	}

	func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
		guard sessionStarted, sampleBuffer.isValid, isRecording else { return }

		if outputType == .screen {
			guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
					  let attachment = attachments.first,
					  let statusRawValue = attachment[SCStreamFrameInfo.status] as? Int,
					  let status = SCFrameStatus(rawValue: statusRawValue),
					  status == .complete else {
				return
			}

			guard let videoInput = videoInput, videoInput.isReadyForMoreMediaData else { return }

			if firstSampleTime == .zero {
				firstSampleTime = sampleBuffer.presentationTimeStamp
			}

			let presentationTime = sampleBuffer.presentationTimeStamp - firstSampleTime
			lastSampleBuffer = sampleBuffer
			let timing = CMSampleTimingInfo(duration: sampleBuffer.duration, presentationTimeStamp: presentationTime, decodeTimeStamp: sampleBuffer.decodeTimeStamp)
			if let retimedSampleBuffer = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) {
				videoInput.append(retimedSampleBuffer)
				frameCount += 1
			}
			return
		}

		if outputType == .audio {
			guard primaryAudioSource == .system, let audioInput else { return }
			appendAudioSampleBuffer(sampleBuffer, to: audioInput, firstSampleTime: &firstPrimaryAudioSampleTime)
			return
		}

		if outputType.rawValue == microphoneOutputTypeRawValue {
			if writesMicrophoneToSeparateTrack, let microphoneOnlyInput {
				appendAudioSampleBuffer(sampleBuffer, to: microphoneOnlyInput, firstSampleTime: &firstMicrophoneSampleTime)
			} else if primaryAudioSource == .microphone, let audioInput {
				appendAudioSampleBuffer(sampleBuffer, to: audioInput, firstSampleTime: &firstPrimaryAudioSampleTime)
			}
			return
		}

		return
	}

	func stream(_ stream: SCStream, didStopWithError error: Error) {
		fputs("Error: \(error.localizedDescription)\n", stderr)
		fflush(stderr)
	}

	private func finishCapture() async throws -> String {
		windowValidationTask?.cancel()
		windowValidationTask = nil
		trackedWindowId = nil

		isRecording = false
		if let activeStream = stream {
			do {
				try await activeStream.stopCapture()
			} catch {
				// Stream may have already been stopped by the system — continue with file finalization
			}
		}
		stream = nil

		if let originalBuffer = lastSampleBuffer, let videoInput = videoInput {
			let additionalTime = CMTime(seconds: ProcessInfo.processInfo.systemUptime, preferredTimescale: 600) - firstSampleTime
			let timing = CMSampleTimingInfo(duration: originalBuffer.duration, presentationTimeStamp: additionalTime, decodeTimeStamp: originalBuffer.decodeTimeStamp)
			if let additionalSampleBuffer = try? CMSampleBuffer(copying: originalBuffer, withNewTiming: [timing]) {
				videoInput.append(additionalSampleBuffer)
			}
		}

		assetWriter?.endSession(atSourceTime: lastSampleBuffer?.presentationTimeStamp ?? .zero)
		videoInput?.markAsFinished()
		audioInput?.markAsFinished()
		await assetWriter?.finishWriting()

		microphoneOnlyInput?.markAsFinished()
		await microphoneOnlyWriter?.finishWriting()

		let path = outputURL?.path ?? ""
		assetWriter = nil
		videoInput = nil
		audioInput = nil
		microphoneOnlyWriter = nil
		microphoneOnlyInput = nil
		outputURL = nil
		microphoneOutputURL = nil
		sessionStarted = false
		firstSampleTime = .zero
		firstPrimaryAudioSampleTime = nil
		firstMicrophoneSampleTime = nil
		lastSampleBuffer = nil
		frameCount = 0
		capturesSystemAudio = false
		capturesMicrophone = false
		writesMicrophoneToSeparateTrack = false
		primaryAudioSource = nil
		return path
	}

	private func appendAudioSampleBuffer(_ sampleBuffer: CMSampleBuffer, to input: AVAssetWriterInput, firstSampleTime: inout CMTime?) {
		guard input.isReadyForMoreMediaData else { return }

		if firstSampleTime == nil {
			firstSampleTime = sampleBuffer.presentationTimeStamp
		}

		guard let firstSampleTime else { return }
		let presentationTime = sampleBuffer.presentationTimeStamp - firstSampleTime
		let timing = CMSampleTimingInfo(duration: sampleBuffer.duration, presentationTimeStamp: presentationTime, decodeTimeStamp: sampleBuffer.decodeTimeStamp)
		if let retimedSampleBuffer = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) {
			input.append(retimedSampleBuffer)
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

				do {
					let availableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
					let windowStillAvailable = availableContent.windows.contains(where: { $0.windowID == trackedWindowId })
					if !windowStillAvailable {
						print("WINDOW_UNAVAILABLE")
						fflush(stdout)
						let outputPath = try await self.finishCapture()
						print("Recording stopped. Output path: \(outputPath)")
						fflush(stdout)
						exit(0)
					}
				} catch {
					continue
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
	private let queue = DispatchQueue(label: "openscreen.screencapturekit.commands")
	private let completionGroup = DispatchGroup()

	func start(configJSON: String) {
		completionGroup.enter()
		queue.async {
			Task {
				do {
					try await self.recorder.startCapture(configJSON: configJSON)
				} catch {
					fputs("Error starting capture: \(error.localizedDescription)\n", stderr)
					fflush(stderr)
					self.completionGroup.leave()
				}
			}
		}
	}

	func stop() {
		queue.async {
			Task {
				do {
					let outputPath = try await self.recorder.stopCapture()
					print("Recording stopped. Output path: \(outputPath)")
					fflush(stdout)
					self.completionGroup.leave()
				} catch {
					fputs("Error stopping capture: \(error.localizedDescription)\n", stderr)
					fflush(stderr)
					self.completionGroup.leave()
				}
			}
		}
	}

	func waitUntilFinished() {
		completionGroup.wait()
	}
}

guard CommandLine.arguments.count >= 2 else {
	fputs("Missing config JSON\n", stderr)
	fflush(stderr)
	exit(1)
}

// Force CoreGraphics Services initialization on the main thread.
// Without this, SCContentFilter(desktopIndependentWindow:) crashes with
// CGS_REQUIRE_INIT because CGS is never initialised in a CLI tool.
let _ = CGMainDisplayID()

let service = RecorderService()
service.start(configJSON: CommandLine.arguments[1])

DispatchQueue.global(qos: .utility).async {
	while let input = readLine(strippingNewline: true)?.lowercased() {
		if input == "stop" {
			service.stop()
			break
		}
	}
}

service.waitUntilFinished()

