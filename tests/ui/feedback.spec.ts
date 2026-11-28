import { expect, test } from "@playwright/test";
import { feedbackHandler } from "../../services/supabase/functions/submit-feedback/handler";
import {
	CHUNK_BYTES,
	feedbackUploads,
} from "../../services/supabase/functions/submit-feedback/uploads";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

const replyEmail = "test@email.com";
const replySender = "youngchen3442@gmail.com";
const accountId = "00000000-0000-4000-8000-000000000001";

for (const clearSelection of [false, true]) {
	test(`feedback submits ${clearSelection ? "without an emoji after clearing Neutral" : "with Neutral by default"}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		let requestBody = "";
		await page.route("**/functions/v1/submit-feedback", async (route) => {
			requestBody = route.request().postData() ?? "";
			await route.fulfill({ json: { success: true } });
		});
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Feedback", exact: true })
			.click();
		const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
		const reply = modal.getByRole("checkbox", { name: "Reply to my feedback (shares email)" });
		await expect(reply).not.toBeChecked();
		await expect(
			modal.getByRole("button", { name: /^(Contact|Socials|Join Discord)$/ }),
		).toHaveCount(0);
		const neutral = modal.getByRole("button", { name: "Neutral", exact: true });
		await expect(neutral).toHaveAttribute("aria-pressed", "true");
		if (clearSelection) {
			await neutral.click();
			await expect(modal.locator('[aria-pressed="true"]')).toHaveCount(0);
		}
		await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
		await expect(modal).toBeVisible();
		expect(requestBody).toBe("");
		await modal
			.getByLabel("Description", { exact: true })
			.fill("Please add more keyboard shortcuts.");
		await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
		const confirmation = page.getByRole("dialog", {
			name: "Support request sent",
			exact: true,
		});
		await expect(
			confirmation.getByText("Your ticket has been logged for Recordly.", { exact: true }),
		).toBeVisible();
		await expect(confirmation).not.toContainText(replySender);
		await expect(confirmation.getByRole("button", { name: "Join Discord" })).toBeVisible();
		expect(requestBody).not.toContain('name="replyForAccountId"');
		expect(requestBody).toContain(
			`name="title"\r\n\r\n${clearSelection ? "" : "😐 "}Please add more keyboard shortcuts.`,
		);
		if (clearSelection) {
			await page.getByRole("button", { name: "Close", exact: true }).click();
			await page.getByRole("button", { name: "Recordly account", exact: true }).click();
			await page
				.getByRole("dialog", { name: "Account menu", exact: true })
				.getByRole("button", { name: "Feedback", exact: true })
				.click();
			await expect(neutral).toHaveAttribute("aria-pressed", "true");
			await expect(reply).not.toBeChecked();
		}
	});
}

test("signed-out feedback keeps the sign-in prompt without community links", async ({ page }) => {
	await installDesktopBridge(page, undefined, { signedIn: false });
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Feedback", exact: true }).click();
	const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
	await expect(modal.getByText("Sign in to send feedback.")).toBeVisible();
	await expect(modal.getByRole("checkbox")).toHaveCount(0);
	await expect(
		modal.getByRole("button", { name: /^(Contact|Socials|Join Discord)$/ }),
	).toHaveCount(0);
});

test("feedback preserves a draft on failure, supports attachments, and includes diagnostics automatically", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Feedback", exact: true })
		.click();
	const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
	const frowning = modal.getByRole("button", { name: "Frowning", exact: true });
	await expect(modal.getByLabel("Subject", { exact: true })).toHaveCount(0);
	await modal.getByRole("button", { name: "Loving", exact: true }).click();
	await expect(frowning).toContainText("🙁");
	await frowning.click();
	await expect(modal.getByRole("button", { name: "Loving", exact: true })).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await modal
		.getByLabel("Description", { exact: true })
		.fill("Export stopped before the last frame.");
	await modal.getByLabel("Attach files", { exact: true }).setInputFiles({
		name: "notes.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("Reproduction steps"),
	});
	await expect(modal.getByText("notes.txt", { exact: true })).toBeVisible();
	await modal.getByRole("button", { name: "Remove notes.txt" }).click();
	await expect(modal.getByText("notes.txt", { exact: true })).toHaveCount(0);
	await expect(
		modal.getByText("Diagnostic logs will be attached.", { exact: true }),
	).toBeVisible();
	await expect(modal.getByRole("checkbox")).not.toBeChecked();
	await expect(modal.getByLabel("Title", { exact: true })).toHaveCount(0);
	await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
	await expect(modal.getByRole("alert")).toHaveText(
		"Could not send feedback. Please try again. Report Error",
	);
	const report = modal
		.getByRole("alert")
		.getByRole("button", { name: "Report Error", exact: true });
	await expect(report).toBeVisible();
	// Keyboard focus remains visible despite the global outline reset.
	await page.keyboard.press("Tab");
	await report.focus();
	await expect.poll(() => report.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
	await expect(report).not.toHaveCSS("box-shadow", "none");
	// Pointer focus still suppresses the ring, including shortcut-induced :focus-visible.
	await report.dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
	await expect(report).toHaveAttribute("data-pointer-focus", "");
	await expect
		.poll(() =>
			report.evaluate((node) =>
				getComputedStyle(node).getPropertyValue("--tw-ring-color").trim(),
			),
		)
		.toBe("transparent");
	await expect(frowning).toHaveAttribute("aria-pressed", "true");
	await modal.getByLabel("Description", { exact: true }).fill("Export stops early (updated)");
	await expect(modal.getByRole("alert")).toHaveCount(0);
	await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
	await expect(modal.getByRole("alert")).toBeVisible();
	await modal.getByLabel("Description", { exact: true }).fill("Updated reproduction steps.");
	await expect(modal.getByRole("alert")).toHaveCount(0);
	await page.screenshot({ path: "test-results/feedback.png" });
	await modal.getByRole("button", { name: "Close", exact: true }).click();
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Projects dashboard", exact: true })
		.getByRole("button", { name: "Recordly account" })
		.click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Feedback", exact: true })
		.click();
	await expect(page.getByRole("dialog", { name: "Send feedback", exact: true })).toBeVisible();
	await expect(frowning).toHaveAttribute("aria-pressed", "true");
	await expect(modal.getByLabel("Description", { exact: true })).toHaveValue(
		"Updated reproduction steps.",
	);
});

test("large feedback uploads resume from the last saved chunk without creating a second report", async ({
	page,
}) => {
	await installDesktopBridge(page);
	const size = 2 * CHUNK_BYTES + 11;
	const chunks: number[] = [];
	const ids = new Set<string>();
	let savedBytes = 0;
	let initialized = false;
	let reports = 0;
	let notifications = 0;
	const handle = feedbackUploads({
		authenticate: async (token) =>
			token.endsWith(".ui-test-signature") ? { id: accountId, email: replyEmail } : null,
		prepare: async (_user, id, files) => {
			ids.add(id);
			expect(files).toEqual([{ name: "recording.webm", size, type: "video/webm" }]);
			return reports ? "saved" : "ready";
		},
		find: async () => ({
			files: [{ name: "recording.webm", size, type: "video/webm" }],
			urls: initialized ? { "0": "/upload" } : {},
		}),
		create: async () => "/upload",
		saveUrl: async () => {
			initialized = true;
			return "/upload";
		},
		offset: async () => savedBytes,
		append: async (_url, start, bytes) => {
			expect(start).toBe(savedBytes);
			chunks.push(bytes.byteLength);
			savedBytes += bytes.byteLength;
			if (chunks.length === 1) return null; // The chunk arrived, but the app didn't receive confirmation.
			return savedBytes;
		},
		finish: async (_user, _id, payload) => {
			expect(payload.reply_email).toBe(replyEmail);
			expect(savedBytes).toBe(size);
			reports++;
			return "new";
		},
		savedReplyEmail: async () => replyEmail,
		notify: async () => {
			notifications++;
		},
	});
	await page.route(/\/functions\/v1\/submit-feedback\?upload=/, async (route) => {
		const req = route.request();
		const result = await handle(
			new Request(req.url(), {
				method: req.method(),
				headers: req.headers(),
				body: new Uint8Array(req.postDataBuffer() ?? []),
			}),
			new URL(req.url()),
		);
		if (result.ok && new URL(req.url()).searchParams.get("upload") === "finish") {
			await route.abort(); // The report was saved before the connection was lost.
			return;
		}
		await route.fulfill({
			status: result.status,
			headers: Object.fromEntries(result.headers),
			body: await result.text(),
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Feedback", exact: true })
		.click();
	const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
	await modal.getByLabel("Description", { exact: true }).fill("See the attached recording.");
	await expect(
		modal.getByRole("button", { name: "Attach files (50 MB)", exact: true }),
	).toBeVisible();
	await modal.getByLabel("Attach files", { exact: true }).setInputFiles({
		name: "recording.webm",
		mimeType: "video/webm",
		buffer: Buffer.alloc(size),
	});
	const reply = modal.getByRole("checkbox", { name: "Reply to my feedback (shares email)" });
	await reply.press("Space");
	await expect(reply).toBeChecked();
	const send = modal.getByRole("button", { name: "Send feedback", exact: true });
	await send.click();
	await expect(modal.getByRole("alert")).toContainText("Could not send feedback");
	await expect(modal.getByText("recording.webm", { exact: true })).toBeVisible();
	await send.click();
	await expect(modal.getByRole("alert")).toContainText("Could not send feedback");
	await send.click();
	await expect(page.getByRole("dialog", { name: "Support request sent" })).toContainText(
		`I’ll reach out from ${replySender}.`,
	);
	expect(chunks).toEqual([CHUNK_BYTES, CHUNK_BYTES, 11]);
	expect(ids.size).toBe(1);
	expect(reports).toBe(1);
	expect(notifications).toBe(1);
});

test("feedback stores its attachment and saved export logs through the handler", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await page.addInitScript(() => localStorage.setItem("recordly.theme", "dark"));
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.openExternalUrl = async (url) => {
			document.documentElement.dataset.openedExternalUrl = url;
			return { success: true };
		};
	});
	await page.addInitScript(() => {
		window.electronAPI.getExportDiagnostics = async () => ({
			success: true,
			logs: [
				'2026-10-18T08:00:00.000Z info: [export] failed {"encoderName":"Breeze","error":"Encoder stopped"}',
			],
		});
	});
	const stored: Record<string, unknown>[] = [];
	const uploads = new Map<string, string>();
	const attachment = Buffer.from("Reproduction steps");
	const handle = feedbackHandler({
		authenticate: async (token) =>
			token.endsWith(".ui-test-signature") ? { id: accountId, email: replyEmail } : null,
		reserve: async (_userId, files, bytes) => files === 1 && bytes === attachment.length,
		upload: async (path, file) => {
			uploads.set(path, await file.text());
		},
		insert: async (report) => {
			stored.push(report);
		},
		remove: async (paths) => {
			for (const path of paths) uploads.delete(path);
		},
	});
	await page.route("**/functions/v1/submit-feedback", async (route) => {
		const req = route.request();
		const result = await handle(
			new Request(req.url(), {
				method: req.method(),
				headers: req.headers(),
				body: new Uint8Array(req.postDataBuffer() ?? []),
			}),
		);
		await route.fulfill({
			status: result.status,
			headers: Object.fromEntries(result.headers),
			body: await result.text(),
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Feedback", exact: true })
		.click();
	const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
	await modal
		.getByLabel("Description", { exact: true })
		.fill("The exporter stopped before completion.");
	await modal.getByLabel("Attach files", { exact: true }).setInputFiles({
		name: "notes.txt",
		mimeType: "text/plain",
		buffer: attachment,
	});
	const reply = modal.getByRole("checkbox", { name: "Reply to my feedback (shares email)" });
	await expect(reply).not.toBeChecked();
	await modal.getByText("Reply to my feedback (shares email)", { exact: true }).click();
	await expect(reply).toBeChecked();
	await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
	const confirmation = page.getByRole("dialog", { name: "Support request sent", exact: true });
	await expect(confirmation).toContainText(`I’ll reach out from ${replySender}.`);
	await expect(confirmation).not.toContainText(replyEmail);
	await expect(confirmation.getByRole("heading")).toBeFocused();
	await confirmation.screenshot({ path: test.info().outputPath("feedback-sent.png") });
	await confirmation.getByRole("button", { name: "Join Discord", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-opened-external-url",
		"https://discord.gg/sdv2FBVNgE",
	);
	expect(stored).toHaveLength(1);
	expect(uploads.size).toBe(1);
	const [path, contents] = [...uploads.entries()][0];
	expect(contents).toBe("Reproduction steps");
	expect(stored[0]).toMatchObject({
		user_id: accountId,
		reply_email: replyEmail,
		title: "😐 The exporter stopped before completion.",
		attachments: [{ path, name: "notes.txt", size: attachment.length, type: "text/plain" }],
		logs: expect.stringMatching(/\[export\] failed.*Breeze.*Encoder stopped/),
	});
});
