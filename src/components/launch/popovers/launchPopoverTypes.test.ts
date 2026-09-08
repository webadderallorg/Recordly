import { describe, expect, it } from "vitest";
import { mapCaptureSource, mapRawSource, type DesktopSource } from "./launchPopoverTypes";
const phone = {
	sourceType: "ios-device" as const,
	id: "ios-device:p",
	deviceToken: "p",
	displayName: "Phone",
	generation: 1,
	deviceAudio: "unknown" as const,
};
describe("source mapping boundary", () => {
	it("preserves mobile identity without mapping desktop fields", () => {
		expect(mapCaptureSource(phone)).toBe(phone);
	});
	it("rejects a mobile source at the desktop-only mapping boundary", () => {
		expect(() => mapRawSource(phone as unknown as DesktopSource)).toThrow("INVALID_REQUEST");
	});
});
