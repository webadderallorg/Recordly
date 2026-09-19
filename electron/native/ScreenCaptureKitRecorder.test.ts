import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const recorderSource = readFileSync(
	fileURLToPath(new URL("./ScreenCaptureKitRecorder.swift", import.meta.url)),
	"utf8",
);

describe("ScreenCaptureKitRecorder finalization coordination", () => {
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
	it("anchors warm-start resume timing to video before accepting audio", () => {
		expect(recorderSource).toContain(
			"guard outputType == .screen, let pauseStartedHostTime else",
		);
	});

	it("drops non-monotonic video and audio samples", () => {
		expect(recorderSource).toContain(
			"CMTimeCompare(presentationTime, lastVideoPresentationTime) <= 0",
		);
		expect(recorderSource).toContain(
			"CMTimeCompare(presentationTime, lastPresentationTime) > 0",
		);
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

describe("ScreenCaptureKitRecorder audio continuity", () => {
	it("delivers audio on a dedicated queue and hops onto the recorder queue", () => {
		expect(recorderSource).toContain('DispatchQueue(label: "recordly.screencapturekit.audio")');
		expect(recorderSource).toContain("type: .audio, sampleHandlerQueue: audioQueue");
		expect(recorderSource).toContain(
			"type: microphoneOutputType, sampleHandlerQueue: audioQueue",
		);
		expect(recorderSource).toMatch(/if outputType != \.screen \{\s*queue\.async/);
		expect(recorderSource).toContain("audioQueue.sync {}");
	});

	it("fills audio timestamp gaps with silence instead of compacting the track", () => {
		expect(recorderSource).toContain(
			"appendSilence(matching: sampleBuffer, from: expectedNext, to: presentationTime, into: input, lastPresentationTime: &lastPresentationTime, lastDuration: &lastDuration)",
		);
		expect(recorderSource).toContain("CMAudioSampleBufferCreateReadyWithPacketDescriptions(");
		expect(recorderSource).toContain("lastDuration = sampleBuffer.duration");
		expect(recorderSource).toContain(
			"lastDuration = CMTime(value: CMTimeValue(frames), timescale: CMTimeScale(sampleRate))",
		);
	});

	it("counts dropped audio buffers and reports gaps at finalization", () => {
		expect(recorderSource).toContain("droppedAudioBufferCount += 1");
		expect(recorderSource).toContain("AUDIO_GAPS: droppedBuffers=");
	});
});

describe("ScreenCaptureKitRecorder first frame timing", () => {
	const callback = recorderSource.slice(recorderSource.indexOf("func stream(_ stream:"), recorderSource.indexOf("func stream(_ stream:") + 5000);
	it("validates a complete frame and writer readiness before setting time zero", () => {
		const clock = callback.indexOf("adjustedPresentationTime(for:");
		expect(clock).toBeGreaterThan(callback.indexOf("status == .complete"));
		expect(clock).toBeGreaterThan(callback.indexOf("videoInput.isReadyForMoreMediaData"));
	});
	it("resets the origin after a rejected first frame and gates audio on accepted video", () => {
		expect(callback).toMatch(/else if frameCount == 0\s*\{[^}]*firstSampleTime = \.zero/);
		const audioGuard = callback.indexOf("guard frameCount > 0,");
		expect(audioGuard).toBeGreaterThan(0);
		expect(audioGuard).toBeLessThan(callback.indexOf("if outputType == .audio"));
	});
});
