import { expect, it } from "vitest";
import { resolveEditorStartupView } from "./editorStartupView";

it("shows Home for an empty app session", () => {
	expect(resolveEditorStartupView({})).toBe("home");
});
for (const source of [
	{ projectPath: "/projects/demo.recordly" },
	{ videoPath: "/recordings/demo.mp4" },
	{ recordingVideoPath: "/recordings/fresh.mp4" },
	{ devInput: "/fixtures/demo.mp4" },
	{ smokeExport: true },
]) {
	it(`uses the editor skeleton for ${Object.keys(source)[0]}`, () => {
		expect(resolveEditorStartupView(source)).toBe("editor");
	});
}
