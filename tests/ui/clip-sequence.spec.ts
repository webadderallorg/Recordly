import { expect, type Locator, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

const clipsFor = (page: Page) => page.locator('[data-variant="clip"]');
const sourceTime = (page: Page) =>
	page
		.locator('video[aria-hidden="true"]')
		.evaluate((video: HTMLVideoElement) => video.currentTime);
const spanFor = async (item: Locator) => ({
	start: Number(await item.getAttribute("data-start-ms")),
	end: Number(await item.getAttribute("data-end-ms")),
});

async function seekInsideClip(page: Page, clip: Locator, fraction: number) {
	const box = (await clip.locator(".timeline-block").boundingBox())!;
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(box.x + box.width * fraction, row.y - 8);
}

async function splitInsideClip(page: Page, clip: Locator, fraction: number) {
	const count = await clipsFor(page).count();
	await seekInsideClip(page, clip, fraction);
	await page.getByRole("button", { name: "Split Clip (C)", exact: true }).click();
	await expect(clipsFor(page)).toHaveCount(count + 1);
}

async function dragLeftEdge(page: Page, clip: Locator, deltaPx: number) {
	const box = (await clip.boundingBox())!;
	await page.mouse.move(box.x + 2, box.y + 20);
	await page.mouse.down();
	await page.mouse.move(box.x + 2 + deltaPx, box.y + 20, { steps: 12 });
	await page.mouse.up();
}

async function makeThreeClips(page: Page) {
	const clips = clipsFor(page);
	await splitInsideClip(page, clips.first(), 1 / 3);
	await splitInsideClip(page, clips.nth(1), 1 / 2);
}

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(clipsFor(page)).toHaveAttribute("data-end-ms", "6000", { timeout: 20000 });
});

test("left trimming keeps both gutter edges at one timestamp and can reveal footage again", async ({
	page,
}) => {
	const clips = clipsFor(page);
	await splitInsideClip(page, clips.first(), 0.5);
	const first = clips.nth(0);
	const second = clips.nth(1);
	const cut = (await spanFor(first)).end;
	await dragLeftEdge(page, second, 60);
	await expect.poll(async () => (await spanFor(second)).end).toBeLessThan(5900);
	const trimmed = await spanFor(second);
	expect(trimmed.start).toBe(cut);
	await expect(first).toHaveAttribute("data-end-ms", String(cut));
	const removedMs = 6000 - trimmed.end;
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	const left = (await first.locator(".timeline-block").boundingBox())!;
	const right = (await second.locator(".timeline-block").boundingBox())!;
	for (const x of [left.x + left.width + 2, right.x - 2]) {
		await page.mouse.click(x, row.y - 8);
		await expect(page.getByTestId("playhead-cap")).toHaveAttribute(
			"aria-label",
			`Playhead ${(cut / 1000).toFixed(1)}s`,
		);
		await expect.poll(() => sourceTime(page)).toBeCloseTo((cut + removedMs) / 1000, 2);
	}
	// Clip resizing maps its visible body to its full media span, excluding the gutter.
	const restorePixels = (removedMs / (trimmed.end - trimmed.start)) * right.width;
	await dragLeftEdge(page, second, -restorePixels);
	await expect.poll(async () => Math.abs((await spanFor(second)).end - 6000)).toBeLessThan(12);
	await expect(second).toHaveAttribute("data-start-ms", String(cut));
	const restored = (await second.locator(".timeline-block").boundingBox())!;
	await page.mouse.click(restored.x - 2, row.y - 8);
	await expect.poll(() => sourceTime(page)).toBeCloseTo(cut / 1000, 1);
});

test("dragging the first clip past the middle clip inserts between its neighbors", async ({
	page,
}) => {
	await makeThreeClips(page);
	const clips = clipsFor(page);
	const before = await Promise.all([
		spanFor(clips.nth(0)),
		spanFor(clips.nth(1)),
		spanFor(clips.nth(2)),
	]);
	const first = (await clips.nth(0).boundingBox())!;
	const second = (await clips.nth(1).boundingBox())!;
	await page.mouse.move(first.x + first.width / 2, first.y + 20);
	await page.mouse.down();
	await page.mouse.move(second.x + second.width / 2 + 15, second.y + 20, { steps: 16 });
	await page.mouse.up();
	const expectedOrder = [before[1], before[0], before[2]];
	for (let index = 0; index < 3; index += 1) {
		await seekInsideClip(page, clips.nth(index), 0.5);
		await expect
			.poll(() => sourceTime(page))
			.toBeCloseTo((expectedOrder[index].start + expectedOrder[index].end) / 2000, 1);
	}
	const after = await Promise.all([
		spanFor(clips.nth(0)),
		spanFor(clips.nth(1)),
		spanFor(clips.nth(2)),
	]);
	expect(after[0].start).toBe(0);
	expect(after[0].end).toBe(after[1].start);
	expect(after[1].end).toBe(after[2].start);
	expect(after[2].end).toBe(6000);
});

test("clip deletion and undo ripple connected annotations and imported audio together", async ({
	page,
}) => {
	await makeThreeClips(page);
	const clips = clipsFor(page);
	const removedDuration = (await spanFor(clips.first())).end;
	await seekInsideClip(page, clips.nth(2), 0.25);
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Annotation", exact: true }).click();
	const annotation = page.locator('[data-variant="annotation"]');
	await expect(annotation).toHaveCount(1);
	await page.evaluate(() => {
		window.electronAPI.openAudioFilePicker = async () => ({
			success: true,
			path: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
		});
	});
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Audio", exact: true }).click();
	const audio = page.locator('[data-variant="audio"]');
	await expect(audio).toHaveCount(1);
	const annotationBefore = await spanFor(annotation);
	const audioBefore = await spanFor(audio);
	await clips.first().click({ position: { x: 50, y: 20 } });
	await page.keyboard.press("Delete");
	await expect(clips).toHaveCount(2);
	await expect(annotation).toHaveAttribute(
		"data-start-ms",
		String(annotationBefore.start - removedDuration),
	);
	await expect(audio).toHaveAttribute(
		"data-start-ms",
		String(audioBefore.start - removedDuration),
	);
	await expect(audio).toHaveAttribute("data-end-ms", String(audioBefore.end - removedDuration));
	await expect(clips.last()).toHaveAttribute("data-end-ms", String(6000 - removedDuration));
	await page.keyboard.press("Meta+z");
	await expect(clips).toHaveCount(3);
	await expect(annotation).toHaveAttribute("data-start-ms", String(annotationBefore.start));
	await expect(annotation).toHaveAttribute("data-end-ms", String(annotationBefore.end));
	await expect(audio).toHaveAttribute("data-start-ms", String(audioBefore.start));
	await expect(audio).toHaveAttribute("data-end-ms", String(audioBefore.end));
	await expect(clips.last()).toHaveAttribute("data-end-ms", "6000");
});
