import { expect, type Locator, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function expectDraggableGap(header: Locator, after: Locator, before: Locator) {
	const left = await after.boundingBox();
	const right = await before.boundingBox();
	expect(left).not.toBeNull();
	expect(right).not.toBeNull();
	expect(right!.x - left!.x - left!.width).toBeGreaterThan(8);
	// Electron subtracts every no-drag rectangle, including empty wrapper space.
	const point = {
		x: (left!.x + left!.width + right!.x) / 2,
		y: left!.y + left!.height / 2,
	};
	const regions = await header.evaluate((element, point) => {
		const coversPoint = (node: Element) => {
			const rect = node.getBoundingClientRect();
			return (
				point.x >= rect.left &&
				point.x < rect.right &&
				point.y >= rect.top &&
				point.y < rect.bottom
			);
		};
		return [element, ...element.querySelectorAll("*")]
			.filter(coversPoint)
			.map((node) => getComputedStyle(node).getPropertyValue("-webkit-app-region"));
	}, point);
	expect(regions).toContain("drag");
	expect(regions).not.toContain("no-drag");
	for (const button of await header.getByRole("button").all()) {
		if (await button.isVisible()) {
			await expect(button).toHaveCSS("-webkit-app-region", "no-drag");
		}
	}
}

for (const width of [1440, 800]) {
	test(`empty title bar space stays draggable at button height (${width}px)`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 1000 });
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		const editor = page.locator(".editor-header");
		const clips = editor.getByRole("button", { name: "Clips", exact: true });
		await expect(clips).toBeVisible({ timeout: 30000 });
		await expectDraggableGap(
			editor,
			editor.getByRole("button", { name: "Home", exact: true }),
			editor.getByRole("button", { name: "Rename project", exact: true }),
		);
		if (width === 1440) {
			await expectDraggableGap(
				editor,
				clips,
				editor.getByRole("button", { name: /^Get Cloud(?:,|$)/ }),
			);
		}
		await editor.getByRole("button", { name: "Rename project", exact: true }).click();
		await expect(editor.getByRole("textbox", { name: "Project name", exact: true })).toHaveCSS(
			"-webkit-app-region",
			"no-drag",
		);
		await page.keyboard.press("Escape");
		await editor.getByRole("button", { name: "Home", exact: true }).click();
		const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		await expect(home).toBeVisible();
		await expect(home).not.toHaveAttribute("data-entering");
		const header = home.locator(".app-frame-header");
		await expectDraggableGap(
			header,
			header.getByText("Library", { exact: true }),
			header.getByRole("button", { name: /^Get Cloud(?:,|$)/ }),
		);
	});
}
