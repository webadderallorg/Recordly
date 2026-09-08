import { expect, it } from "vitest";
import { IOS_CAPTURE_ENABLED_BY_DEFAULT, isIOSCaptureEnabled } from "./featurePolicy";
it("is default off on every platform and packaged builds ignore development overrides", () => {
	expect(IOS_CAPTURE_ENABLED_BY_DEFAULT).toBe(false);
	expect(isIOSCaptureEnabled("darwin", false, {})).toBe(false);
	expect(isIOSCaptureEnabled("darwin", true, { RECORDLY_ENABLE_IOS_CAPTURE: "1" })).toBe(false);
	expect(isIOSCaptureEnabled("linux", false, { RECORDLY_ENABLE_IOS_CAPTURE: "1" })).toBe(false);
	expect(isIOSCaptureEnabled("win32", false, { RECORDLY_ENABLE_IOS_CAPTURE: "1" })).toBe(false);
	expect(isIOSCaptureEnabled("darwin", false, { RECORDLY_ENABLE_IOS_CAPTURE: "1" })).toBe(true);
});
