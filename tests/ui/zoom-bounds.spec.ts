import { expect, type Locator, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function prepare(page: Page, constraint?: string) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto(`/tests/ui/zoom-bounds.html${constraint ? `?constraint=${constraint}` : ""}`);
	const first = page.locator('[data-variant="zoom"]').filter({ hasText: "1.8" });
	await expect(first).toBeVisible();
	const clipItem = page.locator('[data-variant="clip"]');
	const clip = (await clipItem.boundingBox())!;
	const duration = Number(await clipItem.getAttribute("data-end-ms"));
	return { first, pxPerMs: clip.width / duration, clip };
}
async function bounds(item: Locator) {
	const box = (await item.boundingBox())!;
	return {
		start: await item.getAttribute("data-start-ms"),
		end: await item.getAttribute("data-end-ms"),
		storedEnd: await item.getAttribute("data-stored-end-ms"),
		x: box.x,
		width: box.width,
	};
}
async function resize(page: Page, item: Locator, edge: "start" | "end", delta: number) {
	const box = (await item.boundingBox())!;
	const x = edge === "start" ? box.x + 2 : box.x + box.width - 2;
	await page.mouse.move(x, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(x + delta, box.y + box.height / 2, { steps: 12 });
	await page.mouse.up();
}

test("nearby additions, removals and connection toggles preserve authored zoom bounds", async ({
	page,
}) => {
	const { first } = await prepare(page);
	const original = await bounds(first);
	for (const [button, expected] of [
		["Add after", { count: 2, connected: "true" }],
		["Add before", { count: 3, connected: "true" }],
		["Toggle connections", { count: 3, connected: "false" }],
		["Toggle connections", { count: 3, connected: "true" }],
		["Move neighbor away", { count: 3, connected: "true" }],
		["Remove neighbors", { count: 1, connected: "true" }],
		["Add short after", { count: 2, connected: "true" }],
	] as const) {
		await page.getByRole("button", { name: button, exact: true }).click();
		await expect(page.locator('[data-variant="zoom"]')).toHaveCount(expected.count);
		await expect(page.locator("main")).toHaveAttribute("data-connected", expected.connected);
		if (button === "Move neighbor away") {
			await expect(page.locator('[data-variant="zoom"][data-start-ms="8000"]')).toBeVisible();
		}
		expect(await bounds(first)).toEqual(original);
	}
	const short = page.locator('[data-variant="zoom"][data-start-ms="4500"]');
	await expect(short).toHaveAttribute("data-stored-end-ms", "4600");
	expect(Number(await short.getAttribute("data-end-ms"))).toBeLessThanOrEqual(4600);
});

for (const constraint of ["timeline", "neighbor"]) {
	test(`left resizing against a ${constraint} limit preserves the untouched visible edge`, async ({
		page,
	}) => {
		const { first, pxPerMs } = await prepare(page, constraint);
		const original = await bounds(first);
		await resize(page, first, "start", -500 * pxPerMs);
		const resized = await bounds(first);
		expect(resized.end).toBe(original.end);
		expect(Math.abs(resized.x + resized.width - original.x - original.width)).toBeLessThan(0.2);
		expect(Number(resized.storedEnd)).toBeLessThanOrEqual(
			constraint === "timeline" ? 1500 : 1501,
		);
		// The full stored exit is visible; the left edge can use the actual free space.
		expect(Number(resized.start)).toBeGreaterThan(475);
		expect(Number(resized.start)).toBeLessThan(525);
	});
}

test("connected zoom grips resize short blocks without expanding either neighbor", async ({
	page,
}) => {
	const { first, pxPerMs } = await prepare(page);
	const original = await bounds(first);
	await page.getByRole("button", { name: "Add after", exact: true }).click();
	const after = page.locator('[data-variant="zoom"]').filter({ hasText: "1.5" });
	await resize(page, after, "end", -600 * pxPerMs);
	await expect
		.poll(async () => Number(await after.getAttribute("data-stored-end-ms")))
		.toBeLessThan(5000);
	const shortened = await bounds(after);
	await resize(page, after, "start", 100 * pxPerMs);
	// Pointer activation and whole-pixel movement can shift a free edge by a few ms.
	await expect
		.poll(async () => Number(await after.getAttribute("data-start-ms")))
		.toBeGreaterThan(4575);
	expect(Number(await after.getAttribute("data-start-ms"))).toBeLessThan(4625);
	expect(await after.getAttribute("data-end-ms")).toBe(shortened.end);
	const resized = await bounds(after);
	expect(Math.abs(resized.x + resized.width - shortened.x - shortened.width)).toBeLessThan(0.2);
	expect(await bounds(first)).toEqual(original);
	// dnd-kit suppresses document clicks for 50 ms after a pointer drag.
	await page.getByRole("button", { name: "Undo edit", exact: true }).click({ delay: 100 });
	await expect.poll(() => bounds(after)).toEqual(shortened);
});

test("hover placement and dragging across the connection threshold keep widths stable", async ({
	page,
}) => {
	const { first, clip, pxPerMs } = await prepare(page);
	const original = await bounds(first);
	const row = (await page.locator('[data-timeline-row="row-zoom"]').boundingBox())!;
	const x = clip.x + 4500 * pxPerMs;
	const y = row.y + row.height / 2;
	await page.mouse.move(x, y);
	const preview = page.getByTestId("timeline-add-preview").locator(":scope > div");
	await expect(preview).toBeVisible();
	const expected = (await preview.boundingBox())!;
	await page.mouse.click(x, y);
	const after = page.locator('[data-variant="zoom"]').filter({ hasText: "1.5" });
	await expect(after).toBeVisible();
	const beforeDrag = await bounds(after);
	expect(Number(beforeDrag.storedEnd) - Number(beforeDrag.start)).toBe(2000);
	expect(beforeDrag.width).toBeCloseTo(expected.width, 0);
	expect(beforeDrag.x).toBeCloseTo(expected.x, 0);
	expect(await bounds(first)).toEqual(original);
	const box = (await after.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 3000 * pxPerMs, box.y + box.height / 2, {
		steps: 15,
	});
	expect(await bounds(first)).toEqual(original);
	await page.mouse.up();
	await expect
		.poll(async () => Number(await after.getAttribute("data-start-ms")))
		.toBeGreaterThan(7000);
	const moved = await bounds(after);
	expect(moved.width).toBeCloseTo(beforeDrag.width, 0);
	expect(Number(moved.storedEnd) - Number(moved.start)).toBe(
		Number(beforeDrag.storedEnd) - Number(beforeDrag.start),
	);
	expect(await bounds(first)).toEqual(original);
	// dnd-kit suppresses document clicks for 50 ms after a pointer drag.
	await page.getByRole("button", { name: "Undo edit", exact: true }).click({ delay: 100 });
	await expect
		.poll(async () => {
			const regions = JSON.parse((await page.locator("main").getAttribute("data-regions"))!);
			return regions.find((r: { depth: number }) => r.depth === 2)?.startMs;
		})
		.toBe(Number(beforeDrag.start));
	await expect.poll(() => bounds(after)).toEqual(beforeDrag);
});

// The exact exit is fractional, while the visible timeline edge is rounded.
// At the project boundary that rounding must not force a multi-second trim.
test("shortening a boundary zoom follows the left grip without collapsing", async ({ page }) => {
	const { first, pxPerMs } = await prepare(page, "rounded-boundary");
	const original = await bounds(first);
	const box = (await first.boundingBox())!;
	const x = box.x + 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	for (const deltaMs of [100, 300, 600, 300]) {
		await page.mouse.move(x + deltaMs * pxPerMs, y, { steps: 4 });
		const preview = (await first.boundingBox())!;
		expect(preview.x).toBeCloseTo(box.x + deltaMs * pxPerMs, 0);
		expect(preview.x + preview.width).toBeCloseTo(box.x + box.width, 0);
	}
	await page.mouse.up();
	const resized = await bounds(first);
	expect(Number(resized.start)).toBeGreaterThan(11490);
	expect(Number(resized.start)).toBeLessThan(11565);
	expect(resized.end).toBe(original.end);
	expect(Number(resized.storedEnd)).toBeLessThanOrEqual(16256);
	await page.getByRole("button", { name: "Undo edit", exact: true }).click({ delay: 100 });
	await expect.poll(() => bounds(first)).toEqual(original);
});
