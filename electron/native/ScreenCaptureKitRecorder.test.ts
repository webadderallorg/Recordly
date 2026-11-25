import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const recorderSource = readFileSync(
	fileURLToPath(new URL("./ScreenCaptureKitRecorder.swift", import.meta.url)),
	"utf8",
);

describe("ScreenCaptureKitRecorder finalization coordination", () => {
	it("finalizes on parent pipe closure as well as an explicit stop, exactly once", () => {
		const loopStart = recorderSource.search(/while let [A-Za-z_]\w* = readLine\(/);
		expect(loopStart).toBeGreaterThanOrEqual(0);
		const commandLoop = recorderSource.slice(loopStart);
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
	it("computes pause duration on resume, rejects pre-resume samples, and anchors audio to first video frame", () => {
		expect(recorderSource).toContain(
			"let resumedHostTime = CMClockGetTime(CMClockGetHostTimeClock())",
		);
		expect(recorderSource).toContain(
			"if let lastResumeHostTime, CMTimeCompare(sampleTime, lastResumeHostTime) < 0",
		);
		expect(recorderSource).toContain("if firstSampleTime == .zero");
		expect(recorderSource).not.toContain("pendingResumeAdjustment");
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

	it("writes sRGB transfer on macOS 15 and up, with Rec.709 transfer on older builds", () => {
		expect(recorderSource).toContain("AVVideoColorPropertiesKey");
		expect(recorderSource).toContain("AVVideoColorPrimaries_ITU_R_709_2");
		expect(recorderSource).toMatch(
			/if #available\(macOS 15\.0, \*\) \{\s*transferFunction = AVVideoTransferFunction_IEC_sRGB\s*\} else \{\s*transferFunction = AVVideoTransferFunction_ITU_R_709_2/,
		);
		expect(recorderSource).toContain("AVVideoTransferFunctionKey: transferFunction");
		expect(recorderSource).toContain("AVVideoYCbCrMatrix_ITU_R_709_2");
	});

	it("describes full-display sRGB pixels before handing them to the writer", () => {
		const display = recorderSource.slice(
			recorderSource.indexOf("private func retimeDisplayFrame("),
			recorderSource.indexOf("private func appendCroppedVideoFrame("),
		);
		expect(display).toContain(
			"source, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB",
		);
		expect(display).toContain("CMVideoFormatDescription(imageBuffer: source)");
		expect(display).toContain("CMSampleBuffer(imageBuffer: source, formatDescription: format");
		expect(recorderSource).toContain("accepted = videoInput.append(retimed) ? retimed : nil");
		expect(recorderSource).toContain("lastSampleBuffer = accepted");
	});

	it("describes cropped sRGB pixels before handing them to the writer", () => {
		const crop = recorderSource.slice(
			recorderSource.indexOf("private func appendCroppedVideoFrame("),
			recorderSource.indexOf("let appended = adaptor.append(destination,"),
		);
		expect(crop).toContain("colorSpace: CGColorSpace(name: CGColorSpace.sRGB)");
		expect(crop).toContain(
			"destination, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2",
		);
		expect(crop).toContain(
			"destination, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB",
		);
	});
});

describe("ScreenCaptureKitRecorder window capture", () => {
	it("records the display and crops it to the selected window bounds", () => {
		expect(recorderSource).not.toContain("streamConfig.sourceRect");
		expect(recorderSource).not.toContain("desktopIndependentWindow");
		expect(recorderSource).toContain(
			"requestedFrame = CGRect(x: x, y: y, width: width, height: height)",
		);
		expect(recorderSource).toContain(
			"let captureRect = visibleFrame.intersection(display.frame)",
		);
		expect(recorderSource).toContain("appendCroppedVideoFrame(sampleBuffer");
	});

	it("records a fixed area of a display through the same crop", () => {
		expect(recorderSource).toContain("let regionX: Double?");
		expect(recorderSource).toContain("} else if let x = config.regionX,");
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
		const clock = callback.indexOf("adjustedPresentationTime(for:");
		expect(clock).toBeGreaterThan(callback.indexOf("status == .complete"));
		expect(clock).toBeGreaterThan(callback.indexOf("videoInput.isReadyForMoreMediaData"));
	});
	it("resets the origin after a rejected first frame and gates audio on accepted video", () => {
		expect(callback).toMatch(
			/guard let accepted else \{[\s\S]*?if frameCount == 0\s*\{\s*firstSampleTime = \.zero/,
		);
		const audioGuard = callback.indexOf("guard frameCount > 0,");
		expect(audioGuard).toBeGreaterThan(0);
		expect(audioGuard).toBeLessThan(callback.indexOf("if outputType == .audio"));
	});
});
