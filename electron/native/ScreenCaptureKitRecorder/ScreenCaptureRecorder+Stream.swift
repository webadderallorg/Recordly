import Foundation
import ScreenCaptureKit
import AVFoundation

extension ScreenCaptureRecorder {
	func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
		guard sessionStarted, sampleBuffer.isValid, isRecording else { return }
		guard let presentationTime = adjustedPresentationTime(for: sampleBuffer, outputType: outputType) else { return }

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

			lastSampleBuffer = sampleBuffer
			let timing = CMSampleTimingInfo(duration: sampleBuffer.duration, presentationTimeStamp: presentationTime, decodeTimeStamp: sampleBuffer.decodeTimeStamp)
			if let retimedSampleBuffer = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) {
				videoInput.append(retimedSampleBuffer)
				lastVideoPresentationTime = presentationTime
				lastVideoDuration = sampleBuffer.duration
				frameCount += 1
			}
			return
		}

		if outputType == .audio {
			guard let systemAudioInput else { return }
			appendAudioSampleBuffer(sampleBuffer, to: systemAudioInput, firstSampleTime: &firstSystemAudioSampleTime, presentationTime: presentationTime)
			if let inlineAudioInput, inlineAudioInput.isReadyForMoreMediaData {
				appendAudioSampleBuffer(sampleBuffer, to: inlineAudioInput, firstSampleTime: &firstInlineAudioSampleTime, presentationTime: presentationTime)
			}
			return
		}

		if outputType.rawValue == microphoneOutputTypeRawValue {
			if let microphoneOnlyInput {
				appendAudioSampleBuffer(sampleBuffer, to: microphoneOnlyInput, firstSampleTime: &firstMicrophoneSampleTime, presentationTime: presentationTime)
			}
			if !capturesSystemAudio, let inlineAudioInput, inlineAudioInput.isReadyForMoreMediaData {
				appendAudioSampleBuffer(sampleBuffer, to: inlineAudioInput, firstSampleTime: &firstInlineAudioSampleTime, presentationTime: presentationTime)
			}
		}
	}

	func stream(_ stream: SCStream, didStopWithError error: Error) {
		fputs("Error: \(error.localizedDescription)\n", stderr)
		fflush(stderr)
	}

	func finishCapture() async throws -> String {
		windowValidationTask?.cancel()
		windowValidationTask = nil
		trackedWindowId = nil

		if let activeStream = stream {
			do {
				try await activeStream.stopCapture()
			} catch {
			}
		}
		stream = nil
		isRecording = false

		if let originalBuffer = lastSampleBuffer, let videoInput = videoInput {
			let additionalTime = lastVideoPresentationTime + frameDuration(for: originalBuffer)
			let timing = CMSampleTimingInfo(duration: originalBuffer.duration, presentationTimeStamp: additionalTime, decodeTimeStamp: originalBuffer.decodeTimeStamp)
			if let additionalSampleBuffer = try? CMSampleBuffer(copying: originalBuffer, withNewTiming: [timing]) {
				videoInput.append(additionalSampleBuffer)
			}
		}

		let videoEndTime = lastVideoPresentationTime + (lastSampleBuffer.map { frameDuration(for: $0) } ?? .zero)
		let endTime = resolvedCaptureEndTime(videoEndTime: videoEndTime)
		assetWriter?.endSession(atSourceTime: endTime)
		videoInput?.markAsFinished()
		inlineAudioInput?.markAsFinished()
		await assetWriter?.finishWriting()

		systemAudioInput?.markAsFinished()
		await systemAudioWriter?.finishWriting()

		microphoneOnlyInput?.markAsFinished()
		await microphoneOnlyWriter?.finishWriting()

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
		return path
	}

	private func adjustedPresentationTime(for sampleBuffer: CMSampleBuffer, outputType: SCStreamOutputType) -> CMTime? {
		if isPaused {
			return nil
		}

		let sampleTime = sampleBuffer.presentationTimeStamp
		if pendingResumeAdjustment, let pauseStartedHostTime {
			let pauseGap = sampleTime - pauseStartedHostTime
			if pauseGap > .zero {
				accumulatedPausedDuration = accumulatedPausedDuration + pauseGap
			}
			self.pauseStartedHostTime = nil
			pendingResumeAdjustment = false
		}

		if outputType == .screen, firstSampleTime == .zero {
			firstSampleTime = sampleTime
		}

		if firstSampleTime == .zero {
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

		let tailExtension = CMTimeSubtract(inlineAudioEndTime, videoEndTime)
		return videoEndTime + CMTimeMinimum(tailExtension, maxInlineAudioTailExtension)
	}

	private func appendAudioSampleBuffer(_ sampleBuffer: CMSampleBuffer, to input: AVAssetWriterInput, firstSampleTime: inout CMTime?, presentationTime: CMTime) {
		guard input.isReadyForMoreMediaData else { return }

		if firstSampleTime == nil {
			firstSampleTime = presentationTime
		}

		let timing = CMSampleTimingInfo(duration: sampleBuffer.duration, presentationTimeStamp: presentationTime, decodeTimeStamp: sampleBuffer.decodeTimeStamp)
		if let retimedSampleBuffer = try? CMSampleBuffer(copying: sampleBuffer, withNewTiming: [timing]) {
			let appended = input.append(retimedSampleBuffer)
			if appended, input === inlineAudioInput {
				lastInlineAudioPresentationTime = presentationTime
				lastInlineAudioDuration = sampleBuffer.duration
			}
		}
	}
}