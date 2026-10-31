import { expect, it } from "vitest";
import { isHudInEditorMode } from "./hudEditorMode";
it("allows the webcam when New prepares a recording despite an existing editor", () => {
	expect(isHudInEditorMode(1, false, false)).toBe(true);
	expect(isHudInEditorMode(1, true, false)).toBe(false);
	expect(isHudInEditorMode(1, true, true)).toBe(false);
	// Cancelling leaves the HUD ready to retry, including its webcam preview.
	expect(isHudInEditorMode(1, true, false)).toBe(false);
	// Returning Home stops an idle camera, but does not stop an active capture preview.
	expect(isHudInEditorMode(1, false, false)).toBe(true);
	expect(isHudInEditorMode(1, false, true)).toBe(false);
	expect(isHudInEditorMode(0, false, false)).toBe(false);
});
