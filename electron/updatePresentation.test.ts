import { describe, expect, it } from "vitest";
import { getUpdatePresentation } from "./updatePresentation";

describe("update notifications", () => {
	const base = {
		recording: false,
		editorVisible: false,
		notifyOnOpen: false,
		platform: "darwin",
		automaticDownloads: true,
	};
	it("opens a ready notification when the app is opened", () => {
		const phase = "ready";
		expect(getUpdatePresentation({ ...base, phase, notifyOnOpen: true })).toBe("notification");
		expect(
			getUpdatePresentation({ ...base, phase, notifyOnOpen: true, editorVisible: true }),
		).toBe("notification");
		expect(
			getUpdatePresentation({ ...base, phase, notifyOnOpen: true, platform: "win32" }),
		).toBe("native");
	});
	it.each([
		"available",
		"downloading",
		"ready",
		"error",
	] as const)("keeps %s updates quiet while recording", (phase) => {
		expect(getUpdatePresentation({ ...base, phase, notifyOnOpen: true, recording: true })).toBe(
			"silent",
		);
	});
	it("keeps background update discovery out of the HUD", () => {
		expect(getUpdatePresentation({ ...base, phase: "available" })).toBe("silent");
		expect(getUpdatePresentation({ ...base, phase: "available", notifyOnOpen: true })).toBe(
			"silent",
		);
		expect(getUpdatePresentation({ ...base, phase: "error", notifyOnOpen: true })).toBe(
			"silent",
		);
		expect(getUpdatePresentation({ ...base, phase: "ready" })).toBe("silent");
		expect(getUpdatePresentation({ ...base, phase: "available", editorVisible: true })).toBe(
			"inline",
		);
	});

	it("offers manual download on app open when automatic downloads are off", () => {
		expect(
			getUpdatePresentation({
				...base,
				phase: "available",
				notifyOnOpen: true,
				automaticDownloads: false,
			}),
		).toBe("notification");
	});
	it("does not open a popup for background downloads or empty state", () => {
		expect(getUpdatePresentation({ ...base, phase: "downloading", notifyOnOpen: true })).toBe(
			"silent",
		);
		expect(getUpdatePresentation({ ...base, notifyOnOpen: true })).toBe("silent");
	});
	it("keeps the opened notification visible through download and ready states", () => {
		for (const phase of ["downloading", "ready"] as const) {
			expect(getUpdatePresentation({ ...base, phase, notificationVisible: true })).toBe(
				"notification",
			);
		}
	});
});
