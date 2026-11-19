// Local fixtures only; no account or cloud mutations.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 15_000 });
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.LIBRARY_TEST_PORT || 5198);
const base = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url);
const astroPackage = require.resolve("astro/package.json");
const astroBin = join(dirname(astroPackage), require(astroPackage).bin.astro);
const server = spawn(
	process.execPath,
	[astroBin, "dev", "--ignore-lock", "--host", "127.0.0.1", "--port", String(port)],
	{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "",
	browser;
server.stdout.on("data", (chunk) => {
	output += chunk;
});
server.stderr.on("data", (chunk) => {
	output += chunk;
});
try {
	const deadline = Date.now() + 60_000;
	while (true) {
		if (server.exitCode !== null) throw new Error(output);
		try {
			if ((await fetch(`${base}/lib`)).ok) break;
		} catch {
			/* Retry until the development server starts or the deadline expires. */
		}
		if (Date.now() > deadline) throw new Error(`Astro startup timed out: ${output}`);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const video = {
		share_code: "fixture",
		title: "A detailed recording title that remains readable across two lines in the cloud library",
		duration: 125,
		width: 1920,
		height: 1080,
		file_size: 500,
		created_at: "2026-10-22 00:00:00",
		expires_at: null,
		view_count: 23,
		is_meeting: 0,
		upload_completed: 1,
		is_protected: 1,
	};
	let fail = true,
		videos = [video],
		requests = 0;
	await page.route("**/api/videos*", (route) => {
		requests++;
		return route.fulfill({
			status: fail ? 500 : 200,
			json: fail ? { error: "fixture failure" } : { videos },
		});
	});
	await page.route("**/thumb/**", (route) => route.fulfill({ status: 404, body: "" }));
	await page.addInitScript(() =>
		localStorage.setItem(
			"recordly-cloud-folders",
			JSON.stringify([{ id: "empty", name: "Product demos", codes: [] }]),
		),
	);
	await page.goto(`${base}/lib`);
	await expect(page.getByText("Could not load your recordings. Please try again.")).toBeVisible();
	fail = false;
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(page.getByRole("link", { name: video.title, exact: true })).toHaveAttribute(
		"href",
		"/s/fixture",
	);
	await expect(page.getByText("23 views", { exact: true })).toBeVisible();
	await expect(page.getByText("No scheduled expiry", { exact: true })).toBeVisible();
	await expect(page.getByText("Password protected", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Duration 2:05")).toBeVisible();
	await expect(page.getByText("LP", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Select recordings to delete" }).click();
	await expect(page.getByRole("link", { name: video.title, exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: video.title, exact: true }).last().click();
	await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Product demos", exact: true }).click();
	await expect(page.getByRole("heading", { name: "This folder is empty" })).toBeVisible();
	await page.getByRole("button", { name: "Browse shared recordings" }).click();
	await page.getByRole("textbox", { name: "Search recordings" }).fill("absent recording");
	await expect(
		page.getByRole("heading", { name: "No recordings match your filters" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Clear filters" }).click();
	await expect(page.getByRole("link", { name: video.title, exact: true })).toBeVisible();
	await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
	await page.screenshot({ path: join(tmpdir(), "recordly-library-desktop.png"), fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole("button", { name: `Add folder to ${video.title}` })).toBeVisible();
	if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
		throw new Error("Mobile library overflows horizontally");
	await page.screenshot({ path: join(tmpdir(), "recordly-library-mobile.png"), fullPage: true });
	videos = [{ ...video, expires_at: "2000-01-01T00:00:00Z", is_protected: 0, view_count: 1 }];
	await page.reload();
	await expect(page.getByText("Expired", { exact: true })).toBeVisible();
	await expect(page.getByText("Anyone with the link", { exact: true })).toBeVisible();
	await expect(page.getByText("1 view", { exact: true })).toBeVisible();
	videos = [];
	await page.reload();
	await expect(page.getByRole("heading", { name: "No shared recordings yet" })).toBeVisible();
	await page.getByRole("button", { name: "How to publish a recording" }).click();
	await expect(page.getByRole("dialog")).toContainText("choose Publish, then Link");
	expect(requests).toBe(4);
	expect(errors).toEqual([]);
	console.log(
		"PASS library retry, metadata, title selection, folder/filter/first-use states, publish help, mobile layout",
	);
} finally {
	await browser?.close();
	server.kill("SIGTERM");
}
