import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("clip duration appears on hover or selection and follows speed, splits and trimming", async ({
	page,
}) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-timeline-item][data-variant="clip"]');
	await expect(clips).toHaveAttribute("data-end-ms", "6000", { timeout: 30000 });
	const duration = clips.locator("[data-clip-duration]");
	await expect(duration).toHaveText("6.0s");
	await expect(duration).toBeHidden();
	await expect(clips.locator(".speed-icon")).toHaveCount(0);
	await clips.hover();
	await expect(duration).toBeVisible();
	const blockBounds = (await clips.locator(".timeline-block").boundingBox())!;
	const badgeBounds = (await duration.boundingBox())!;
	expect(badgeBounds.x - blockBounds.x).toBeCloseTo(7, 0);
	expect(badgeBounds.y - blockBounds.y).toBeCloseTo(5, 0);
	await clips.click();
	await page.getByRole("button", { name: "Home", exact: true }).hover();
	await expect(duration).toBeVisible();

	const speed = page.getByRole("slider", { name: "Speed", exact: true });
	await speed.focus();
	await page.keyboard.press("ArrowRight");
	await expect(speed).toHaveValue("1.25");
	await expect(duration).toHaveText("4.8s");
	await expect(clips).toHaveAttribute("data-end-ms", "4800");
	const speedIcon = clips.locator(".speed-icon");
	const speedValue = speedIcon.locator("..").locator("span");
	const checkCompactSpeed = async () => {
		const block = clips.locator(".timeline-block");
		for (const width of [56, 24]) {
			await block.evaluate((node: HTMLElement, width) => {
				node.style.width = `${width}px`;
			}, width);
			await expect(speedValue).toBeHidden();
			await expect(speedIcon).toBeVisible();
			const iconBounds = (await speedIcon.boundingBox())!;
			const blockBounds = (await block.boundingBox())!;
			expect(iconBounds.x).toBeGreaterThanOrEqual(blockBounds.x);
			expect(iconBounds.x + iconBounds.width).toBeLessThanOrEqual(
				blockBounds.x + blockBounds.width,
			);
		}
		await page.screenshot({
			path: test.info().outputPath(`compact-speed-${await speed.inputValue()}.png`),
		});
		await block.evaluate((node: HTMLElement) => node.style.removeProperty("width"));
		await expect(speedValue).toBeVisible();
	};
	await expect(speedIcon).toBeVisible();
	await expect(speedIcon).toHaveAttribute("fill", "currentColor");
	await checkCompactSpeed();
	const rabbitPath = await speedIcon.locator("path").getAttribute("d");
	await page.screenshot({ path: test.info().outputPath("clip-speed-rabbit.png") });
	await page.keyboard.press("ArrowLeft");
	await expect(speed).toHaveValue("1");
	await expect(speedIcon).toHaveCount(0);
	await page.keyboard.press("ArrowLeft");
	await expect(speed).toHaveValue("0.75");
	await expect(speedIcon).toBeVisible();
	await expect(speedIcon).toHaveAttribute("fill", "currentColor");
	await checkCompactSpeed();
	await expect(clips).toHaveAttribute("data-end-ms", "8000");
	await expect(duration).toHaveText("8.0s");
	expect(await speedIcon.locator("path").getAttribute("d")).not.toBe(rabbitPath);
	await page.screenshot({ path: test.info().outputPath("clip-speed-tortoise.png") });
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");
	await expect(speed).toHaveValue("1.25");

	const body = (await clips.locator(".timeline-block").boundingBox())!;
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(body.x + body.width / 2, row.y - 8);
	await page.getByRole("button", { name: /^Split Clip \(/ }).click();
	await expect(clips).toHaveCount(2);
	await expect(clips.locator("[data-clip-duration]")).toHaveText(["2.4s", "2.4s"]);
	await clips.nth(1).click();
	await page.getByRole("button", { name: "Home", exact: true }).hover();
	await expect(clips.nth(0).locator("[data-clip-duration]")).toBeHidden();
	await expect(clips.nth(1).locator("[data-clip-duration]")).toBeVisible();

	const last = clips.nth(1);
	const edge = (await last.boundingBox())!;
	await page.mouse.move(edge.x + edge.width - 2, edge.y + 20);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width - 42, edge.y + 20, { steps: 10 });
	await page.mouse.up();
	await expect
		.poll(async () => Number(await last.getAttribute("data-end-ms")))
		.toBeLessThan(4800);
	const length =
		(Number(await last.getAttribute("data-end-ms")) -
			Number(await last.getAttribute("data-start-ms"))) /
		1000;
	await expect(last.locator("[data-clip-duration]")).toHaveText(
		new Intl.NumberFormat("en", {
			style: "unit",
			unit: "second",
			unitDisplay: "narrow",
			minimumFractionDigits: 1,
			maximumFractionDigits: 2,
		}).format(length),
	);
	await page.screenshot({ path: test.info().outputPath("clip-duration-selected.png") });
});
