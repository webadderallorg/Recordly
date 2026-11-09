import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.setTimeout(90_000);

async function installSceneBridge(page: Page) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const key = "recordly.editor.preferences";
		window.electronAPI.getAppSetting = (name) =>
			name === "recordly.onboarding.v1.seen"
				? true
				: JSON.parse(localStorage.getItem(name) ?? "null");
		window.electronAPI.setAppSetting = (name, value) => {
			localStorage.setItem(name, JSON.stringify(value));
			return true;
		};
		window.electronAPI.getCurrentVideoPath = async () => ({
			success: true,
			path: `${location.origin}/tests/ui/fixtures/filmstrip.mp4?project=${new URLSearchParams(location.search).get("project") ?? "first"}`,
		});
		window.electronAPI.loadCurrentProjectFile = async () => {
			if (!new URLSearchParams(location.search).has("older")) return { success: false };
			return {
				success: true,
				path: "/projects/older.recordly",
				project: {
					version: 2,
					videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4?project=older`,
					editor: {
						wallpaper: "#000000",
						padding: { top: 25, bottom: 25, left: 25, right: 25, linked: true },
						shadowIntensity: 0.7,
						backgroundBlur: 4,
						borderRadius: 12,
						aspectRatio: "16:9",
						clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000 }],
					},
				},
			};
		};
		// Start without a preference, as a first-time user would.
		if (!localStorage.getItem(key)) localStorage.setItem(key, "{}");
	});
}

async function openScene(page: Page, url: string) {
	await page.goto(url);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20_000 });
}

async function storedPreferences(page: Page) {
	return page.evaluate(() =>
		JSON.parse(localStorage.getItem("recordly.editor.preferences") ?? "{}"),
	);
}

async function setSlider(page: Page, name: string, steps: number) {
	const slider = page.getByRole("slider", { name, exact: true });
	await slider.press("Home");
	for (let index = 0; index < steps; index++) await slider.press("ArrowRight");
	return slider.inputValue();
}

test("Scene controls carry to new projects; loading an older look does not replace defaults", async ({
	page,
}) => {
	await installSceneBridge(page);
	await openScene(page, "/?windowType=editor&project=first");
	await setSlider(page, "Padding", 8);
	const blur = await setSlider(page, "Blur", 3);
	const shadow = await setSlider(page, "Shadow", 4);
	const radius = await setSlider(page, "Radius", 5);
	await page.getByRole("switch", { name: "Advanced settings", exact: true }).press("Space");
	await page.getByRole("switch", { name: "Link padding sides", exact: true }).press("Space");
	for (const [index, side] of ["Top", "Bottom", "Left", "Right"].entries()) {
		await setSlider(page, side, index + 1);
	}
	await page.getByRole("button", { name: /^Aspect ratio:/ }).click();
	await page
		.getByRole("dialog", { name: "Aspect ratio", exact: true })
		.getByRole("radio", { name: "1:1", exact: true })
		.press("Space");
	await page.keyboard.press("Escape");
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	await page.getByRole("button", { name: "Gradient 1", exact: true }).click();
	const expected = {
		padding: { top: 1, bottom: 2, left: 3, right: 4, linked: false },
		backgroundBlur: Number(blur),
		shadowIntensity: Number(shadow),
		borderRadius: Number(radius),
		aspectRatio: "1:1",
		wallpaper: "linear-gradient(135deg, #dbeafe 0%, #a5b4fc 100%)",
	};
	await expect.poll(() => storedPreferences(page)).toMatchObject(expected);

	// A second recording reads the controls actually saved by the first editor.
	await openScene(page, "/?windowType=editor&project=second");
	for (const [index, side] of ["Top", "Bottom", "Left", "Right"].entries()) {
		await expect(page.getByRole("slider", { name: side, exact: true })).toHaveValue(
			String(index + 1),
		);
	}
	await expect(page.getByRole("slider", { name: "Blur", exact: true })).toHaveValue(blur);
	await expect(page.getByRole("slider", { name: "Shadow", exact: true })).toHaveValue(shadow);
	await expect(page.getByRole("slider", { name: "Radius", exact: true })).toHaveValue(radius);
	await expect(
		page.getByRole("button", { name: "Aspect ratio: 1:1", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Gradient 1", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	await openScene(page, "/?windowType=editor&older=1");
	await expect(
		page.getByRole("button", { name: "Aspect ratio: 16:9", exact: true }),
	).toBeVisible();
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Background color #000000", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByRole("slider", { name: "Padding", exact: true })).toHaveValue("25");
	await expect(page.getByRole("slider", { name: "Shadow", exact: true })).toHaveValue("0.7");
	expect(await storedPreferences(page)).toMatchObject(expected);
	await page.getByRole("slider", { name: "Shadow", exact: true }).press("ArrowRight");
	await expect
		.poll(() => storedPreferences(page))
		.toMatchObject({ ...expected, shadowIntensity: 0.71 });
	await openScene(page, "/?windowType=editor&project=third");
	await expect(page.getByRole("slider", { name: "Top", exact: true })).toHaveValue("1");
	await expect(page.getByRole("slider", { name: "Shadow", exact: true })).toHaveValue("0.71");
	await expect(page.getByRole("button", { name: "Gradient 1", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
});

test("image, video, solid color and gradient selections survive creating another project", async ({
	page,
}) => {
	await installSceneBridge(page);
	await openScene(page, "/?windowType=editor&project=initial");
	const cases = [
		{
			tab: "Image",
			label: "Golden Gate Day",
			wallpaper: "/wallpapers/golden-gate-day-no-vignette.png",
		},
		{ tab: "Video", label: "Wispy Sky", wallpaper: "/wallpapers/wispysky.mp4" },
		{ tab: "Colors", label: "Background color #E2E8F0", wallpaper: "#e2e8f0" },
		{
			tab: "Colors",
			label: "Gradient 2",
			wallpaper: "linear-gradient(135deg, #e0e7ff 0%, #c4b5fd 100%)",
		},
	];
	for (const [index, { tab, label, wallpaper }] of cases.entries()) {
		await page.getByRole("row", { name: tab, exact: true }).click();
		const tile = page.getByRole("button", { name: label, exact: true });
		await tile.click();
		await expect(tile).toHaveAttribute("aria-pressed", "true");
		await expect.poll(() => storedPreferences(page)).toMatchObject({ wallpaper });
		await openScene(page, `/?windowType=editor&project=background-${index}`);
		await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect((await storedPreferences(page)).wallpaper).toBe(wallpaper);
	}
});
