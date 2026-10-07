import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const recorderSource = readFileSync(
	fileURLToPath(new URL("./ScreenCaptureKitRecorder.swift", import.meta.url)),
	"utf8",
);

describe("ScreenCaptureKitRecorder finalization coordination", () => {
	it("finalizes on parent pipe closure as well as an explicit stop, exactly once", () => {
		const commandLoop = recorderSource.slice(
			recorderSource.indexOf("while let input = readLine"),
		);
		expect(commandLoop).toMatch(
			/if input == "stop"\s*\{\s*break\s*\}\s*\}\s*\/\/.*?service\.stop\(\)/s,
		);
		expect(commandLoop.match(/service\.stop\(\)/g)).toHaveLength(1);
	});

	it("marks manual stops as participants in the shared finalization", () => {
		expect(recorderSource).toContain("finalizeCapture(interactive: true)");
		expect(recorderSource).toContain("finalization.outputResult.get()");
		expect(recorderSource).toContain(
			"self.interactiveStopParticipated = self.interactiveStopParticipated || interactive",
		);
	});

	it("does not let automatic window-close exit preempt a joined manual stop", () => {
		expect(recorderSource).toContain("self.finalizeCapture(interactive: false)");
		expect(recorderSource).toMatch(
			/if finalization\.interactiveStopParticipated\s*\{\s*return\s*\}/,
		);
	});
});

describe("ScreenCaptureKitRecorder resume timing", () => {
	it("resumes on the host clock so speech after the countdown is kept", () => {
		expect(recorderSource).toContain("func resume(atHostTime hostTime: CMTime)");
		expect(recorderSource).toContain(
			"self.clock.resume(atHostTime: RecordingClock.hostTime())",
		);
		expect(recorderSource).not.toContain("pendingResumeAdjustment");
	});

	it("holds the last frame until the stop instead of ending at the last change", () => {
		expect(recorderSource).toContain("private func appendStillFrameIfIdle()");
		expect(recorderSource).toContain("endTime - tailDuration");
		expect(recorderSource).toContain("assetWriter.endSession(atSourceTime: endTime)");
	});

	it("drops non-monotonic video frames", () => {
		expect(recorderSource).toContain(
			"CMTimeCompare(presentationTime, lastVideoPresentationTime) <= 0",
		);
	});
});

describe("ScreenCaptureKitRecorder audio", () => {
	const track = recorderSource.slice(
		recorderSource.indexOf("final class AudioTimelineTrack"),
		recorderSource.indexOf("final class ScreenCaptureRecorder"),
	);

	it("delivers audio on its own queue, never behind video work", () => {
		expect(recorderSource).toContain(
			"try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)",
		);
		expect(recorderSource).toContain(
			"try stream.addStreamOutput(self, type: microphoneOutputType, sampleHandlerQueue: audioQueue)",
		);
	});

	it("never drops a buffer because an encoder is busy", () => {
		expect(track).toContain("try sidecar.write(from: buffer)");
		expect(track).toContain("pendingInline.append(sampleBuffer)");
		expect(track).not.toMatch(/isReadyForMoreMediaData else \{\s*return/);
	});

	it("fills delivery gaps with silence and pads every track to the end", () => {
		expect(track).toContain("writeSilence(frames: limited(drift))");
		expect(recorderSource).toContain("track.finish(padTo: endFrame)");
	});
});

describe("ScreenCaptureKitRecorder colour metadata", () => {
	it("asks ScreenCaptureKit for BT.709-compatible video-range frames", () => {
		expect(recorderSource).toContain(
			"streamConfig.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange",
		);
		expect(recorderSource).toContain("streamConfig.colorSpaceName = CGColorSpace.sRGB");
		expect(recorderSource).toContain(
			"streamConfig.colorMatrix = CGDisplayStream.yCbCrMatrix_ITU_R_709_2",
		);
		expect(recorderSource).toContain("kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange");
		expect(recorderSource).toContain("sourceFormatHint: sourceVideoFormat");
		expect(recorderSource).not.toContain("videoCodecType: .h264");
	});

	it("tags recordings as BT.709", () => {
		expect(recorderSource).toContain("AVVideoColorPropertiesKey");
		expect(recorderSource).toContain("AVVideoColorPrimaries_ITU_R_709_2");
		expect(recorderSource).toContain("AVVideoTransferFunction_ITU_R_709_2");
		expect(recorderSource).toContain("AVVideoYCbCrMatrix_ITU_R_709_2");
	});
});

describe("ScreenCaptureKitRecorder window capture", () => {
	it("records the display and crops it to the selected window bounds", () => {
		expect(recorderSource).not.toContain("streamConfig.sourceRect");
		expect(recorderSource).not.toContain("desktopIndependentWindow");
		expect(recorderSource).toContain(
			"visibleFrame = CGRect(x: x, y: y, width: width, height: height)",
		);
		expect(recorderSource).toContain(
			"let captureRect = visibleFrame.intersection(display.frame)",
		);
		expect(recorderSource).toContain("appendCroppedVideoFrame(sampleBuffer");
	});

	it("refreshes the crop and capture display while the window moves or resizes", () => {
		expect(recorderSource).toContain(
			"guard let display = Self.captureDisplay(for: window.frame",
		);
		expect(recorderSource).toContain("try await activeStream.updateContentFilter(filter)");
		expect(recorderSource).toContain("self.windowCropRect = cropRect");
	});
});

describe("ScreenCaptureKitRecorder first frame timing", () => {
	const callback = recorderSource.slice(
		recorderSource.indexOf("func stream(_ stream:"),
		recorderSource.indexOf("func stream(_ stream:") + 5000,
	);
	it("validates a complete frame and writer readiness before setting time zero", () => {
		const clock = callback.indexOf("clock.videoTime(for:");
		expect(clock).toBeGreaterThan(callback.indexOf("status == .complete"));
		expect(clock).toBeGreaterThan(callback.indexOf("videoInput.isReadyForMoreMediaData"));
	});
	it("resets the origin after a rejected first frame and gates audio on accepted video", () => {
		expect(callback).toMatch(/else if frameCount == 0\s*\{[^}]*clock\.clearOrigin\(\)/);
		const audioGuard = callback.indexOf("guard let presentationTime = clock.audioTime(for:");
		expect(audioGuard).toBeGreaterThan(0);
		expect(audioGuard).toBeLessThan(callback.indexOf("if outputType == .audio"));
		expect(recorderSource).toContain(
			"guard origin.isValid, pauseStartedAt == nil else { return nil }",
		);
	});
});
