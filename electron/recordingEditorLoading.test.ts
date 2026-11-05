import { expect, it } from "vitest";
import { createRecordingEditorLoading } from "./recordingEditorLoading";

it("holds editor hydration until the recording owner finishes persistence", async () => {
	const loading = createRecordingEditorLoading();
	expect(loading.begin(10)).toBe(true);
	let ready = false;
	const hydration = loading.wait().then((result) => {
		ready = true;
		return result;
	});
	await Promise.resolve();
	expect(ready).toBe(false);
	expect(loading.active).toBe(true);
	expect(loading.finish(11)).toBe(false);
	expect(loading.begin(12)).toBe(false);
	expect(loading.finish(10)).toBe(true);
	expect(await hydration).toEqual({});
	expect(loading.active).toBe(false);
	expect(await loading.wait()).toEqual({});
});

it("surfaces finalization failure even if editor hydration starts after it", async () => {
	const loading = createRecordingEditorLoading();
	loading.begin(10);
	loading.finish(10, "Recording interrupted");
	expect(await loading.wait()).toEqual({ error: "Recording interrupted" });
	loading.clearError();
	expect(await loading.wait()).toEqual({});
	loading.begin(12);
	const next = loading.wait();
	loading.finish(12);
	expect(await next).toEqual({});
});
