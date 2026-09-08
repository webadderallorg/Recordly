import { describe, expect, it } from "vitest";
import { getIOSCapturePresentation } from "./iosCapturePresentation";
import { EMPTY_IOS_SNAPSHOT } from "../hooks/useIOSDeviceRecorder";
describe("iOS capture presentation", () => {
	it.each([
		"unavailable",
		"idle",
		"discovering",
		"preparing",
		"starting",
		"recording",
		"interrupted",
		"finalising",
	] as const)("presents %s from authoritative state", (phase) => {
		expect(getIOSCapturePresentation({ ...EMPTY_IOS_SNAPSHOT, phase }).statusKey).toBe(
			`ios.status.${phase}`,
		);
	});
	it("requires validated video format and mode for Ready, not a JPEG", () => {
		const value = getIOSCapturePresentation({ ...EMPTY_IOS_SNAPSHOT, phase: "ready" });
		expect(value.canRecord).toBe(false);
		expect(value.statusKey).toBe("ios.status.preparing");
	});
	it("shows permission guidance only for denial", () => {
		expect(
			getIOSCapturePresentation({
				...EMPTY_IOS_SNAPSHOT,
				error: { code: "PERMISSION_DENIED", recoverable: false },
			}).errorKey,
		).toBe("ios.errors.PERMISSION_DENIED");
		expect(getIOSCapturePresentation(EMPTY_IOS_SNAPSHOT).errorKey).toBeNull();
	});
});

it("distinguishes a discovered device from a prepared recording", () => {
	const devices = [
		{
			sourceType: "ios-device" as const,
			id: "ios-device:p",
			deviceToken: "p",
			displayName: "Phone",
			generation: 1,
			deviceAudio: "unknown" as const,
		},
	];
	const presentation = getIOSCapturePresentation({
		...EMPTY_IOS_SNAPSHOT,
		phase: "idle",
		devices,
	});
	expect(presentation.statusKey).toBe("ios.status.connected");
	expect(presentation.canRecord).toBe(false);
});

it("retains native warning codes separately from terminal errors", () => {
	const presentation = getIOSCapturePresentation({
		...EMPTY_IOS_SNAPSHOT,
		phase: "recording",
		warningCodes: [
			"AUDIO_INTERRUPTED",
			"DISK_SPACE_LOW",
			"FORMAT_CHANGED",
			"AUDIO_INTERRUPTED",
			"NEW_WARNING",
		],
	});
	expect(presentation.warningKeys).toEqual([
		"ios.warnings.AUDIO_INTERRUPTED",
		"ios.warnings.DISK_SPACE_LOW",
		"ios.warnings.FORMAT_CHANGED",
		"ios.warnings.other",
	]);
	expect(presentation.audioStatusKey).toBe("ios.audioInterrupted");
});
it("labels requested audio without asserting samples were recorded", () => {
	const presentation = getIOSCapturePresentation({
		...EMPTY_IOS_SNAPSHOT,
		phase: "recording",
		options: { deviceAudio: true, microphoneToken: "mic" },
	});
	expect(presentation.audioStatusKey).toBe("ios.deviceAudioRequested");
});
