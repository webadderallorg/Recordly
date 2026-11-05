import { expect, type Locator, test } from "@playwright/test";

const focusStyle = (control: Locator) =>
	control.evaluate(async (element) => {
		// Compare settled focus styles, rather than different points in HeroUI's transition.
		getComputedStyle(element).boxShadow;
		await Promise.all(
			element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
		);
		const style = getComputedStyle(element);
		return { outline: style.outline, offset: style.outlineOffset, shadow: style.boxShadow };
	});

for (const name of ["Native control", "HeroUI control"]) {
	test(`${name}: mouse then editor shortcuts add no ring; Tab keeps the exact original focus style`, async ({
		page,
	}) => {
		await page.goto("/tests/ui/pointer-focus.html?baseline");
		const control = page.getByRole("button", { name, exact: true });
		await page.keyboard.press("Tab");
		if (name === "HeroUI control") await page.keyboard.press("Tab");
		await expect(control).toBeFocused();
		const baseline = await focusStyle(control);
		await page.goto("/tests/ui/pointer-focus.html");
		await control.click();
		await expect(control).toHaveAttribute("data-pointer-focus", "");
		await control.press("Space");
		await expect(page.getByLabel("Press count")).toHaveText("2");
		await expect(control).toBeFocused();
		await expect(control).toHaveCSS("outline-style", "none");
		await expect(control).toHaveCSS("--tw-ring-color", "transparent");
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		await expect(control).toBeFocused();
		await expect(control).not.toHaveAttribute("data-pointer-focus");
		await expect.poll(() => focusStyle(control)).toEqual(baseline);
		await control.press("Space");
		await expect(page.getByLabel("Press count")).toHaveText("3");
		await expect.poll(() => focusStyle(control)).toEqual(baseline);
		// Clicking a control that already has keyboard focus switches back to mouse focus.
		await control.click();
		await control.press("Space");
		await expect(control).toHaveAttribute("data-pointer-focus", "");
		await expect(control).toHaveCSS("outline-style", "none");
		await expect(control).toHaveCSS("--tw-ring-color", "transparent");
		for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "k"]) {
			await control.press(key);
			await expect(control).toBeFocused();
			await expect(control).toHaveAttribute("data-pointer-focus", "");
			await expect(control).toHaveCSS("outline-style", "none");
			await expect(control).toHaveCSS("--tw-ring-color", "transparent");
		}
		await control.press("Tab");
		await page.keyboard.press("Shift+Tab");
		await expect(control).toBeFocused();
		await expect(control).not.toHaveAttribute("data-pointer-focus");
		await expect.poll(() => focusStyle(control)).toEqual(baseline);
	});
}

test("Space on a mouse-focused caption does not add its blue outline; Tab styling is unchanged", async ({
	page,
}) => {
	await page.goto("/tests/ui/caption-preview.html");
	const caption = page.getByRole("button", { name: "Edit current caption", exact: true });
	await expect(caption).toBeVisible();
	await page.getByRole("spinbutton", { name: "Time", exact: true }).focus();
	await page.keyboard.press("Tab");
	await expect(caption).toBeFocused();
	const baseline = await focusStyle(caption);
	await page.evaluate(async () => {
		const modulePath = "/src/lib/pointerFocus.ts";
		const { installPointerFocusGuard } = await import(modulePath);
		installPointerFocusGuard();
	});
	await caption.click();
	await caption.press("Space");
	await expect(caption).toBeFocused();
	await expect(caption).toHaveCSS("outline-style", "none");
	await page.keyboard.press("Tab");
	await page.keyboard.press("Shift+Tab");
	await expect(caption).toBeFocused();
	await expect.poll(() => focusStyle(caption)).toEqual(baseline);
	await caption.press("Space");
	await expect.poll(() => focusStyle(caption)).toEqual(baseline);
});

test("text input focus and typing stay unchanged", async ({ page }) => {
	await page.goto("/tests/ui/pointer-focus.html?baseline");
	const input = page.getByRole("textbox", { name: "Text input" });
	await input.click();
	const baseline = await focusStyle(input);
	await page.goto("/tests/ui/pointer-focus.html");
	await input.click();
	await expect(input).not.toHaveAttribute("data-pointer-focus");
	await expect.poll(() => focusStyle(input)).toEqual(baseline);
	await input.fill("Typing");
	await input.press("Space");
	await expect(input).toHaveValue("Typing ");
});
