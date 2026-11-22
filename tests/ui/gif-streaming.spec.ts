import { expect, test } from "@playwright/test";

test("streamed GIF preserves decoded pixels, frame order, timing and looping", async ({ page }) => {
	await page.goto("/tests/ui/gif-streaming.html");
	await page.getByRole("button", { name: "Compare encoders" }).click();
	await expect(page.locator("#result")).toContainText('"streamed"', { timeout: 20000 });
	const { streamed, original } = JSON.parse(await page.locator("#result").innerText());
	expect(streamed.frames).toHaveLength(24);
	expect(streamed.frames).toEqual(original.frames);
	expect(streamed.loop).toBe(original.loop);
	expect(streamed.header).toBe("GIF89a");
	expect(streamed.trailer).toBe(0x3b);
	expect(streamed.size).toBeLessThanOrEqual(original.size);
});

test("real video rendering exports a complete GIF without emitting 100%", async ({ page }) => {
	await page.route("**/tests/ui/wasm/web-demuxer.wasm", (route) =>
		route.fulfill({
			path: "public/wasm/web-demuxer.wasm",
			contentType: "application/wasm",
		}),
	);
	await page.goto("/tests/ui/gif-streaming.html");
	await page.getByRole("button", { name: "Export video" }).click();
	await expect(page.locator("#result")).not.toHaveText("working", { timeout: 25000 });
	const result = JSON.parse(await page.locator("#result").innerText());
	expect(result.error).toBeUndefined();
	expect(result.gif.frames).toHaveLength(90);
	expect(result.totalFrames).toBe(90);
	expect(
		result.gif.frames.every(
			(frame: { width: number; height: number; duration: number }) =>
				frame.width === 160 && frame.height === 90 && frame.duration === 70_000,
		),
	).toBe(true);
	expect(result.gif.trailer).toBe(0x3b);
	expect(result.percentages.length).toBeGreaterThan(10);
	expect(result.percentages.every((value: number) => value >= 0 && value <= 95)).toBe(true);
	expect(result.percentages).toEqual(
		[...result.percentages].sort((a: number, b: number) => a - b),
	);
	expect(result.phases.at(-1)).toBe("finalizing");
});

test("estimates a real video from a centered 60-frame seek window", async ({ page }) => {
	await page.route("**/tests/ui/wasm/web-demuxer.wasm", (route) =>
		route.fulfill({ path: "public/wasm/web-demuxer.wasm", contentType: "application/wasm" }),
	);
	await page.addInitScript(() => {
		Object.assign(window, {
			electronAPI: {
				optimizeGif: async (_id: string, bytes: ArrayBuffer) => ({
					success: true,
					data: new Uint8Array(bytes),
				}),
			},
		});
	});
	await page.goto("/tests/ui/gif-streaming.html");
	await page.getByRole("button", { name: "Estimate video" }).click();
	await expect(page.locator("#result")).not.toHaveText("working", { timeout: 25000 });
	const result = JSON.parse(await page.locator("#result").innerText());
	expect(result.error).toBeUndefined();
	expect(result.sampleFrames).toBe(60);
	expect(result.totalFrames).toBe(90);
	expect(result.originalBytes).toBeGreaterThan(100);
	expect(result.optimizedBytes).toBe(result.originalBytes);
});

test("sample seek preserves full-decode pixels and export/source/cursor timestamps", async ({
	page,
}) => {
	await page.route("**/tests/ui/wasm/web-demuxer.wasm", (route) =>
		route.fulfill({ path: "public/wasm/web-demuxer.wasm", contentType: "application/wasm" }),
	);
	await page.goto("/tests/ui/gif-streaming.html");
	await page.getByRole("button", { name: "Compare sample decode" }).click();
	await expect(page.locator("#result")).not.toHaveText("working", { timeout: 25000 });
	const result = JSON.parse(await page.locator("#result").innerText());
	expect(result.error).toBeUndefined();
	expect(result.completeFrameCount).toBe(90);
	expect(result.sample).toHaveLength(60);
	for (let index = 0; index < result.sample.length; index++) {
		const actual = result.sample[index];
		const expected = result.expected[index];
		expect(actual.hash).toBe(expected.hash);
		expect(actual.exportTimestampUs).toBe(expected.exportTimestampUs);
		expect(actual.sourceTimestampMs).toBeCloseTo(expected.sourceTimestampMs, 6);
		expect(actual.cursorTimestampMs).toBeCloseTo(expected.cursorTimestampMs, 6);
	}
	expect(
		new Set(result.sample.map((frame: { hash: number }) => frame.hash)).size,
	).toBeGreaterThan(1);
	expect(result.sample[0].exportTimestampUs).toBeCloseTo(1_000_000, 6);
	expect(result.sample[0].sourceTimestampMs).toBe(1000);
	expect(result.sample.at(-1).exportTimestampUs).toBeCloseTo((74 * 1_000_000) / 15);
});
