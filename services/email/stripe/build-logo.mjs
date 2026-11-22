import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Match the existing website wordmark: original app mark + bundled DM Sans,
// medium weight, -0.04em tracking. Rasterise at 2x so Stripe needs no web font.
const root = new URL("../../../", import.meta.url);
const mark = (
	await readFile(new URL("public/app-icons/recordly-mark.svg", root), "utf8")
).replaceAll("#FFFFFF", "#006fee");
const font = await readFile(new URL("src/assets/fonts/dm-sans/DMSans-Variable.ttf", root));
const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage({
		viewport: { width: 1800, height: 400 },
		deviceScaleFactor: 2,
	});
	await page.setContent(`<style>
@font-face{font-family:'DM Sans';font-style:normal;font-weight:100 1000;src:url(data:font/ttf;base64,${font.toString("base64")}) format('truetype')}
html,body{margin:0;background:transparent}
.wordmark{display:inline-flex;align-items:center;gap:72px;padding:8px;font-family:'DM Sans';font-size:192px;font-weight:500;line-height:1.2;letter-spacing:-.04em;color:#18181b;white-space:nowrap}
.wordmark svg{width:201.6px;height:201.6px;flex-shrink:0}
</style><div class="wordmark">${mark}<span>Recordly</span></div>`);
	await page.evaluate(() => document.fonts.ready);
	if (
		!(await page.evaluate(() =>
			[...document.fonts].some(
				(font) => font.family === "DM Sans" && font.status === "loaded",
			),
		))
	)
		throw new Error("DM Sans did not load");
	const output = fileURLToPath(new URL("recordly-logo-with-text.png", import.meta.url));
	await page.locator(".wordmark").screenshot({ path: output, omitBackground: true });
	console.log(`Built transparent Recordly logo with DM Sans wordmark: ${output}`);
} finally {
	await browser.close();
}
