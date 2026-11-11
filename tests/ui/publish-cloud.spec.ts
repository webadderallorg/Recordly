import { expect, test } from "@playwright/test";

for (const full of [false, true]) {
	test(`Share is immediately clickable while quota is pending (${full ? "full" : "available"})`, async ({
		page,
	}) => {
		await page.goto(`/tests/ui/publish.html?controlled-capacity${full ? "&full" : ""}`);
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		const share = page.getByRole("button", { name: "Share", exact: true });
		await expect(share).toBeEnabled();
		await share.click();
		await expect(page.locator("html")).toHaveAttribute("data-capacity-checks", "2");
		await expect(page.locator("html")).not.toHaveAttribute("data-preparation-started");
		await page
			.getByRole("button", { name: "Fixture finish capacity checks", exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		if (full) {
			const card = page.getByRole("region", { name: "Create link", exact: true });
			await expect(card.getByRole("alert")).toContainText("You have 5 cloud recordings");
			await card.getByRole("button", { name: "Try again", exact: true }).click();
			await expect(share).toBeDisabled();
			await expect(page.locator("html")).not.toHaveAttribute("data-preparation-started");
			const details = page.getByRole("button", { name: "Technical details", exact: true });
			await expect(details).toHaveAttribute("aria-expanded", "false");
			await details.click();
			await expect(details).toHaveAttribute("aria-expanded", "true");
			await expect(
				page.getByText(
					"You have 5 cloud recordings. Delete one from Shared before sharing another.",
				),
			).toBeVisible();
			await expect(share).toBeDisabled();
			await expect(page.locator("html")).not.toHaveAttribute("data-preparation-started");
		} else {
			await expect(page.locator("html")).toHaveAttribute("data-preparation-started", "true");
		}
	});
}

test("publish preserves local destination and sharing continues in the background", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await page.goto("/tests/ui/publish.html?switch");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("row", { name: "Save to device", exact: true }).click();
	await page.screenshot({
		path: test.info().outputPath("publish-destinations.png"),
		animations: "disabled",
	});
	await expect(page.getByRole("button", { name: "Export Video", exact: true })).toBeVisible();
	await page.reload();
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByRole("row", { name: "Save to device", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.getByRole("row", { name: "Create share link", exact: true }).click();
	await page.getByRole("button", { name: "Share", exact: true }).click();
	await expect(page.getByRole("progressbar").getByText(/^\d+%$/)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("progressbar").getByText(/^\d+%$/)).toBeVisible();
	await expect(page.getByRole("dialog", { name: "Publish", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeVisible({
		timeout: 20000,
	});
	await page
		.getByRole("button", { name: "Fixture refresh token", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
	await expect(page.getByRole("region", { name: "Create link" })).toHaveCount(0, {
		timeout: 15_000,
	});
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Share link" })).toHaveValue(
		"https://example.test/s/preview",
	);
	await page.getByRole("row", { name: "Save to device", exact: true }).click();
	await page.getByRole("row", { name: "Create share link", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Share link" })).toHaveValue(
		"https://example.test/s/preview",
	);
	await page.keyboard.press("Escape");
	await page
		.getByRole("button", { name: "Fixture switch account", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Share link" })).toHaveCount(0);
});

test("a full cloud quota prevents starting preparation", async ({ page }) => {
	await page.goto("/tests/ui/publish.html?full");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(
		page.getByText(
			"You have 5 cloud recordings. Delete one from Shared before sharing another.",
		),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
});

test("shared cards open ready links and delete incomplete uploads", async ({ page }) => {
	await page.goto("/tests/ui/shared-recordings.html");
	await page.getByRole("button", { name: "Product walkthrough", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Opened https://example.test/s/demo1");
	await expect(
		page.getByRole("button", { name: "An interrupted upload", exact: true }),
	).toBeDisabled();
	await page
		.getByRole("button", { name: "Options for An interrupted upload", exact: true })
		.click();
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "An interrupted upload", exact: true }),
	).toHaveCount(1);
	await page
		.getByRole("button", { name: "Options for An interrupted upload", exact: true })
		.click();
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "An interrupted upload", exact: true }),
	).toHaveCount(0);
	await page.getByRole("textbox", { name: "Search projects" }).fill("missing");
	await expect(page.getByText("No matching shared recordings", { exact: true })).toBeVisible();
});

test("switching accounts clears the previous account's cloud quota", async ({ page }) => {
	await page.goto("/tests/ui/publish.html?full&switch");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(
		page.getByText(
			"You have 5 cloud recordings. Delete one from Shared before sharing another.",
		),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Fixture sign out", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(
		page.getByText(
			"You have 5 cloud recordings. Delete one from Shared before sharing another.",
		),
	).toHaveCount(0);
	await page
		.getByRole("button", { name: "Fixture switch account", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
});

test("remounting with a deleted share prop cannot resurrect its link", async ({ page }) => {
	await page.goto("/tests/ui/publish.html?switch&stale-prop");
	await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
		"https://example.test/s/original",
	);
	await page.getByRole("button", { name: "Fixture delete original share", exact: true }).click();
	await expect(page.getByLabel("Share link", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Fixture unmount sharing", exact: true }).click();
	await page.getByRole("button", { name: "Fixture mount sharing", exact: true }).click();
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
	await expect(page.getByLabel("Share link", { exact: true })).toHaveCount(0);
});

for (const fails of [false, true]) {
	test(`ignores an old account's late upload ${fails ? "error" : "success"}`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(`/tests/ui/publish.html?switch&controlled${fails ? "&fail" : ""}`);
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await page.getByRole("button", { name: "Share", exact: true }).click();
		await expect(page.getByText("85%", { exact: true })).toBeVisible();
		await page
			.getByRole("button", { name: "Fixture switch account", exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await page
			.getByRole("button", { name: "Fixture finish upload", exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
		await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(0);
		await expect(
			page.getByText("Fixture old-account upload failed", { exact: true }),
		).toHaveCount(0);
	});
}

test("deleting from another shared library refreshes a mounted Share quota", async ({ page }) => {
	await page.goto("/tests/ui/shared-recordings.html?capacity");
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
	await page
		.getByRole("button", { name: "Options for An interrupted upload", exact: true })
		.click();
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
	await page
		.getByRole("button", { name: "Options for An interrupted upload", exact: true })
		.click();
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "An interrupted upload", exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
	await expect(
		page.getByText(
			"You have 5 cloud recordings. Delete one from Shared before sharing another.",
		),
	).toHaveCount(0);
});

for (const destination of ["Save to device", "Create share link"]) {
	test(`Publish sends a user-requested error report for ${destination}`, async ({ page }) => {
		const cloud = destination === "Create share link";
		const reports: Record<string, unknown>[] = [];
		await page.route("**/functions/v1/submit-export-error", async (route) => {
			const request = route.request();
			expect(request.method()).toBe("POST");
			expect(request.headers().authorization).toBeUndefined();
			expect(request.headers().cookie).toBeUndefined();
			expect(request.headers().referer).toBeUndefined();
			reports.push(request.postDataJSON());
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ success: true }),
			});
		});
		await page.goto(
			cloud
				? "/tests/ui/publish.html?controlled&fail&switch"
				: "/tests/ui/publish.html?export-error",
		);
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await page.getByRole("row", { name: destination, exact: true }).click();
		if (cloud) {
			await page.getByRole("button", { name: "Share", exact: true }).click();
			await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "85");
			await page
				.getByRole("button", { name: "Fixture finish upload", exact: true })
				.evaluate((button: HTMLButtonElement) => button.click());
		}
		const publish = page.getByRole("region", {
			name: cloud ? "Create link" : "Export",
			exact: true,
		});
		const report = publish.getByRole("button", { name: "Report Error", exact: true });
		await expect(report).toBeVisible();
		expect(reports).toHaveLength(0);
		await report.click();
		await expect(
			publish.getByRole("button", { name: "Report sent", exact: true }),
		).toHaveAttribute("aria-disabled", "true");
		await expect(
			publish.getByRole("status").filter({ hasText: "Error and diagnostic logs sent." }),
		).toBeVisible();
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({
			schemaVersion: 2,
			context: cloud ? "cloud-share" : "export",
			format: cloud ? "unknown" : "mp4",
			error: cloud
				? "Fixture old-account upload failed"
				: "[VIDEO_DECODE_ENCODING_ERROR] sourceTimeSec=0.500",
		});
		expect(JSON.parse(reports[0].logs as string)).toMatchObject({ logs: expect.any(Array) });
	});
}

test("publishing omits file-size estimates for both destinations", async ({ page }) => {
	await page.goto("/tests/ui/publish.html");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	const estimate = page.getByRole("status", { name: "Estimated file size", exact: true });
	await expect(estimate).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
	await page.getByRole("row", { name: "Save to device", exact: true }).click();
	await expect(estimate).toHaveCount(0);
	await page.getByRole("row", { name: "Create share link", exact: true }).click();
	await expect(estimate).toHaveCount(0);
});

test("share uses one continuous progress bar from export to link creation", async ({ page }) => {
	await page.goto("/tests/ui/publish.html?switch&controlled&saved");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("button", { name: "Share", exact: true }).click();
	const progress = page.getByRole("progressbar");
	await expect(progress).toHaveCount(1);
	await expect(progress).toHaveAttribute("aria-valuenow", "35");
	const card = page.getByRole("region", { name: "Create link", exact: true });
	await expect(card.getByRole("status")).toContainText("Preparing the current edit…");
	await expect(page.getByRole("dialog", { name: "Publish", exact: true })).toHaveCount(0);
	await expect(page.locator(".export-animation")).toHaveCount(0);
	await expect(page.locator("body")).toHaveAttribute("data-share-armed-before-export", "true");
	await expect(progress).toBeVisible();
	await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(progress).toBeVisible();
	await expect(progress).toHaveAttribute("aria-valuenow", "70");
	await expect(page.getByText("Uploading video…", { exact: true })).toBeVisible();
	await expect(progress).toHaveAttribute("aria-valuenow", "85");
	await expect(page.locator(".export-animation")).toHaveCount(0);
	await expect(progress).toHaveCount(1);
	await page.clock.install();
	await page
		.getByRole("button", { name: "Fixture finish upload", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(progress).toHaveCount(0);
	await expect(page.locator(".export-animation")).toHaveCount(0);
	await expect(page.locator("body")).toHaveAttribute("data-share-upload-id-preserved", "true");
	await expect(card.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
	await page.clock.fastForward(10100);
	await expect(card).toHaveCount(0);
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
		"https://example.test/s/preview",
	);
});

async function seedExistingShare(page: import("@playwright/test").Page) {
	await page.addInitScript(() => {
		localStorage.setItem(
			"recordly.project-share-links.v1",
			JSON.stringify({
				"/fixture.recordly": {
					url: "https://example.test/s/original",
					sharedAt: 1,
					revision: "revision-1",
					accountId: "fixture-account",
				},
			}),
		);
	});
}

test("existing project links reopen the completed copy-link view without exporting", async ({
	page,
}) => {
	await seedExistingShare(page);
	await page.goto("/tests/ui/publish.html?saved");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
		"https://example.test/s/original",
	);
	await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toHaveCount(0);
	await expect(page.getByRole("progressbar")).toHaveCount(0);
	await page.getByRole("button", { name: "Copy link", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-copied-share-url",
		"https://example.test/s/original",
	);
	await expect(page.locator("html")).not.toHaveAttribute("data-preparation-started", "true");
});

for (const fails of [false, true]) {
	test(`stale links offer Regenerate and ${fails ? "keep the original link on failure" : "save the new link on success"}`, async ({
		page,
	}) => {
		await seedExistingShare(page);
		await page.goto(
			`/tests/ui/publish.html?saved&edited&controlled&switch${fails ? "&fail" : ""}`,
		);
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
			"https://example.test/s/original",
		);
		await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
		await expect(page.getByRole("progressbar")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Regenerate", exact: true }).locator("svg"),
		).toHaveCount(1);
		await page.getByRole("button", { name: "Regenerate", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-preparation-started", "true");
		await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "85");
		await page
			.getByRole("button", { name: "Fixture finish upload", exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
			`https://example.test/s/${fails ? "original" : "preview"}`,
		);
		await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toHaveCount(
			fails ? 1 : 0,
		);
		await expect(page.getByRole("progressbar")).toHaveCount(0);
		const stored = await page.evaluate(
			() =>
				JSON.parse(localStorage.getItem("recordly.project-share-links.v1")!)[
					"/fixture.recordly"
				],
		);
		expect(stored.revision).toBe(fails ? "revision-1" : "revision-2");
	});
}

for (const action of ["switch account", "sign out"]) {
	test(`immediately cancels an upload on ${action} before its promise settles`, async ({
		page,
	}) => {
		await page.goto("/tests/ui/publish.html?switch&controlled");
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await page.getByRole("button", { name: "Share", exact: true }).click();
		await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "85");
		await page
			.getByRole("button", { name: "Fixture refresh token", exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.locator("html")).not.toHaveAttribute("data-canceled-upload");
		await page
			.getByRole("button", { name: `Fixture ${action}`, exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.locator("html")).toHaveAttribute("data-canceled-expected-upload", "true");
		await page
			.getByRole("button", { name: "Fixture finish upload", exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(0);
	});
	test(`cancels preparation and discards late output on ${action}`, async ({ page }) => {
		await page.goto("/tests/ui/publish.html?switch&controlled-preparation");
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await page.getByRole("button", { name: "Share", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-preparation-started", "true");
		await page
			.getByRole("button", { name: `Fixture ${action}`, exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.locator("html")).toHaveAttribute("data-preparation-canceled", "true");
		await expect(page.locator("html")).toHaveAttribute("data-canceled-expected-upload", "true");
		await page
			.getByRole("button", { name: "Fixture finish preparation", exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.locator("html")).toHaveAttribute(
			"data-discarded-temp",
			"synthetic-preview.mp4",
		);
		await expect(page.locator("html")).not.toHaveAttribute("data-upload-started");
	});
}

test("unmount cancels preparation and discards its late output without publishing", async ({
	page,
}) => {
	await page.goto("/tests/ui/publish.html?switch&controlled-preparation&saved");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("button", { name: "Share", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-preparation-started", "true");
	await page
		.getByRole("button", { name: "Fixture unmount sharing", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.locator("html")).toHaveAttribute("data-canceled-expected-upload", "true");
	await page
		.getByRole("button", { name: "Fixture finish preparation", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.locator("html")).toHaveAttribute(
		"data-discarded-temp",
		"synthetic-preview.mp4",
	);
	await expect(page.locator("html")).toHaveAttribute("data-preparation-canceled", "true");
	await expect(page.locator("html")).not.toHaveAttribute("data-upload-started");
	expect(
		await page.evaluate(() => localStorage.getItem("recordly.project-share-links.v1")),
	).toBeNull();
});

test("unmount while capacity is pending cannot start an export after the check resolves", async ({
	page,
}) => {
	await page.goto("/tests/ui/publish.html?switch&controlled-capacity&controlled-preparation");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-capacity-checks", "1");
	await page.getByRole("button", { name: "Share", exact: true }).click();
	await page
		.getByRole("button", { name: "Fixture unmount sharing", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await page
		.getByRole("button", { name: "Fixture finish capacity checks", exact: true })
		.evaluate(async (button: HTMLButtonElement) => {
			button.click();
			// Let the resolved bridge promise and its async continuations settle.
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	await expect(page.locator("html")).not.toHaveAttribute("data-preparation-started");
	await expect(page.locator("html")).not.toHaveAttribute("data-upload-started");
});

test("failed regeneration cannot restore a share deleted while the upload was pending", async ({
	page,
}) => {
	await seedExistingShare(page);
	await page.goto("/tests/ui/publish.html?saved&edited&controlled&switch&fail");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("button", { name: "Regenerate", exact: true }).click();
	await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "85");
	await page
		.getByRole("button", { name: "Fixture delete original share", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await page
		.getByRole("button", { name: "Fixture finish upload", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.getByRole("progressbar")).toHaveCount(0);
	await expect(page.getByLabel("Share link", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
});

for (const duringUpload of [true, false]) {
	test(`a first project save preserves sharing ${duringUpload ? "during upload" : "after publication"}`, async ({
		page,
	}) => {
		await page.goto("/tests/ui/publish.html?switch&controlled");
		const publish = page.getByRole("button", { name: "Publish", exact: true });
		await publish.click();
		await page.getByRole("button", { name: "Share", exact: true }).click();
		const card = page.getByRole("region", { name: "Create link", exact: true });
		const progress = card.getByRole("progressbar", { name: "Create link", exact: true });
		await expect(progress).toHaveAttribute("aria-valuenow", "85");
		const finish = () =>
			page
				.getByRole("button", { name: "Fixture finish upload" })
				.evaluate((button: HTMLButtonElement) => button.click());
		const save = () =>
			page
				.getByRole("button", { name: "Fixture first project save" })
				.evaluate((button: HTMLButtonElement) => button.click());
		if (duringUpload) {
			await save();
			await expect(publish).toBeDisabled();
			await expect(progress).toHaveAttribute("aria-valuenow", "85");
			await expect(page.locator("html")).not.toHaveAttribute("data-canceled-upload");
			await finish();
		} else {
			await finish();
			await expect(
				card.getByRole("button", { name: "Copy link", exact: true }),
			).toBeVisible();
			await save();
		}
		await expect(card.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						JSON.parse(localStorage.getItem("recordly.project-share-links.v1") ?? "{}")[
							"/fixture.recordly"
						]?.url,
				),
			)
			.toBe("https://example.test/s/preview");
	});
}

for (const saved of [true, false]) {
	test(`opening a saved project cancels sharing from a ${saved ? "saved" : "new"} project using the same recording`, async ({
		page,
	}) => {
		await page.goto(`/tests/ui/publish.html?switch&controlled${saved ? "&saved" : ""}`);
		const publish = page.getByRole("button", { name: "Publish", exact: true });
		await publish.click();
		await page.getByRole("button", { name: "Share", exact: true }).click();
		await expect(page.getByRole("progressbar", { name: "Create link" })).toHaveAttribute(
			"aria-valuenow",
			"85",
		);
		await page
			.getByRole("button", { name: "Fixture switch project" })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.locator("html")).toHaveAttribute("data-canceled-expected-upload", "true");
		await page
			.getByRole("button", { name: "Fixture finish upload" })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(publish).toBeEnabled();
		await publish.click();
		await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
		await expect(page.getByRole("textbox", { name: "Share link" })).toHaveCount(0);
	});
}
