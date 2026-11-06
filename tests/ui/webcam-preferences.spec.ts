import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("opening an older project preserves webcam defaults while subsequent edits still save", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const key = "recordly.editor.preferences";
		if (!localStorage.getItem(key)) {
			localStorage.setItem(key, JSON.stringify({ webcam: { shadow: 0.2 } }));
		}
		const originalGet = window.electronAPI.getAppSetting;
		const originalSet = window.electronAPI.setAppSetting;
		window.electronAPI.getAppSetting = (name) =>
			name === key ? JSON.parse(localStorage.getItem(key)!) : originalGet(name);
		window.electronAPI.setAppSetting = (name, value) => {
			if (name !== key) return originalSet(name, value);
			localStorage.setItem(key, JSON.stringify(value));
			return true;
		};
		const videoPath = `${location.origin}/tests/ui/fixtures/preview.mp4`;
		window.electronAPI.loadCurrentProjectFile = async () =>
			new URLSearchParams(location.search).has("older")
				? {
						success: true,
						path: "/projects/older.recordly",
						project: {
							version: 2,
							videoPath,
							editor: {
								webcam: { enabled: true, sourcePath: videoPath, shadow: 0.67 },
								clipRegions: [{ id: "clip-1", startMs: 0, endMs: 2000 }],
							},
						},
					}
				: { success: false };
		window.electronAPI.getCurrentRecordingSession = async () => ({
			success: true,
			session: { videoPath, webcamPath: videoPath, timeOffsetMs: 0 },
		});
	});
	const storedShadow = () =>
		page.evaluate(
			() => JSON.parse(localStorage.getItem("recordly.editor.preferences")!).webcam.shadow,
		);
	await page.goto("/?windowType=editor&older=1");
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	const shadow = page.getByRole("slider", { name: "Webcam Shadow" });
	await expect(shadow).toHaveValue("0.67");
	expect(await storedShadow()).toBe(0.2);

	// Editing another webcam control must not promote the old project's shadow.
	await page.getByRole("slider", { name: "Webcam Width" }).press("ArrowRight");
	await expect
		.poll(() =>
			page.evaluate(
				() => JSON.parse(localStorage.getItem("recordly.editor.preferences")!).webcam.width,
			),
		)
		.toBe(31);
	expect(await storedShadow()).toBe(0.2);

	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await page.getByRole("slider", { name: "Shadow", exact: true }).press("ArrowRight");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(localStorage.getItem("recordly.editor.preferences")!)
						.shadowIntensity,
			),
		)
		.toBe(0.51);
	expect(await storedShadow()).toBe(0.2);
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();

	await shadow.press("Home");
	await expect.poll(storedShadow).toBe(0);
	for (let i = 0; i < 20; i++) await shadow.press("ArrowRight");
	await expect(shadow).toHaveValue("0.2");
	await expect.poll(storedShadow).toBe(0.2);

	// Reopening the original restores its own look without changing new recordings.
	await page.reload();
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	await expect(shadow).toHaveValue("0.67");
	expect(await storedShadow()).toBe(0.2);
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	await expect(shadow).toHaveValue("0.2");
});
