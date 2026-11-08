// Local shared-checkout viewer with fixture auth APIs; no cloud writes or real sign-in.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 15_000 });
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const port = 5197;
const base = `http://127.0.0.1:${port}`;
const outputDir = process.env.COMMENT_TEST_OUTPUT || "/tmp/recordly-comment-accounts";
await mkdir(outputDir, { recursive: true });
let output = "";
const server = spawn(
	process.execPath,
	[
		fileURLToPath(new URL("../node_modules/astro/bin/astro.mjs", import.meta.url)),
		"dev",
		"--ignore-lock",
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
	],
	{ cwd: webRoot, stdio: ["ignore", "pipe", "pipe"] },
);
server.stdout.on("data", (data) => {
	output += data;
});
server.stderr.on("data", (data) => {
	output += data;
});
let browser;
try {
	const deadline = Date.now() + 60000;
	while (true) {
		if (server.exitCode !== null) throw new Error(output);
		try {
			if ((await fetch(`${base}/share`)).ok) break;
		} catch {
			// Connection failures are expected until the development server is ready.
		}
		if (Date.now() > deadline) throw new Error(output);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	page.setDefaultTimeout(15000);
	const openFeedback = async () => {
		const app = page.locator(".recording-app");
		await expect(app).toHaveAttribute("data-mobile-view", /watch|feedback/);
		if ((await app.getAttribute("data-mobile-view")) === "watch")
			await page
				.getByRole("button", {
					name: feedbackEnabled ? "Comment" : "Comments",
					exact: true,
				})
				.click();
	};
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const user = {
		id: "fixture-reviewer",
		email: "private@example.test",
		email_confirmed_at: "2026-01-01T00:00:00Z",
		aud: "authenticated",
		app_metadata: {},
		user_metadata: {},
	};
	let token = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.fixture`;
	const session = {
		access_token: token,
		refresh_token: "fixture-refresh",
		token_type: "bearer",
		expires_in: 3600,
		user,
	};
	let comments = [];
	let nameStatus = 500;
	let mutationStatus = 200;
	let ownershipGate = null;
	let postGate = null;
	let postStatus = 200;
	let feedbackEnabled = true;
	let commentsStatus = 200;
	const posts = [];
	const postRequests = [];
	const memberNames = new Map();
	const commentReads = [];
	const video = {
		title: "Account comment fixture",
		duration: 60,
		width: 1280,
		height: 720,
		summary: null,
		has_webcam: 0,
		cta_url: null,
		cta_text: null,
		created_at: "2026-10-21 00:00:00",
		view_count: 1,
		is_meeting: 0,
	};
	await page.route("**/cloud/config", (route) =>
		route.fulfill({
			json: {
				url: "https://comment-fixture.supabase.co",
				publishableKey: "fixture-public-key",
				authCaptcha: { enabled: false },
			},
		}),
	);
	await page.route("https://comment-fixture.supabase.co/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/settings"))
			return route.fulfill({ json: { external: { google: true } } });
		if (path.endsWith("/token")) return route.fulfill({ json: session });
		if (path.endsWith("/user")) {
			if (route.request().method() === "PUT") {
				if (nameStatus !== 200)
					return route.fulfill({
						status: nameStatus,
						json: { message: "Fixture unavailable" },
					});
				const body = route.request().postDataJSON();
				expect(Object.keys(body.data)).toEqual(["full_name"]);
				user.user_metadata.full_name = body.data.full_name;
			}
			return route.fulfill({ json: user });
		}
		return route.fulfill({ json: {} });
	});
	await page.route("**/s/**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/data"))
			return route.fulfill({
				json: {
					video: { ...video, feedback_enabled: feedbackEnabled },
					segments: [],
					chapters: [],
					shareCode: "fixture123",
				},
			});
		if (path.endsWith("/comments")) {
			if (ownershipGate && route.request().headers().authorization) await ownershipGate;
			commentReads.push({
				authorization: route.request().headers().authorization,
				total: comments.length,
			});
			return route.fulfill({
				status: commentsStatus,
				json: {
					comments: comments.map(({ owner, ...item }) => ({
						...item,
						can_manage:
							route.request().headers().authorization === `Bearer ${token}` &&
							owner === user.id,
					})),
					total: comments.length,
					page: 1,
					limit: 50,
				},
			});
		}
		const management = path.match(/\/comments\/(\d+)$/);
		if (management) {
			expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
			const item = comments.find(
				(comment) => comment.id === Number(management[1]) && comment.owner === user.id,
			);
			if (!item) return route.fulfill({ status: 404, json: {} });
			if (mutationStatus !== 200) return route.fulfill({ status: mutationStatus, json: {} });
			if (route.request().method() === "PATCH") {
				const body = route.request().postDataJSON();
				expect(Object.keys(body)).toEqual(["text"]);
				item.text = body.text;
			} else {
				expect(route.request().method()).toBe("DELETE");
				comments = comments.filter((comment) => comment.id !== item.id);
			}
			return route.fulfill({ json: { ok: true } });
		}
		if (path.endsWith("/comment")) {
			// Authentication belongs to the request, even when another tab switches
			// accounts before this deliberately delayed server mutation completes.
			const requestToken = route
				.request()
				.headers()
				.authorization?.replace(/^Bearer /, "");
			expect(requestToken, "POST must carry a bearer token").toBeTruthy();
			const requestOwner = JSON.parse(
				Buffer.from(requestToken.split(".")[1], "base64url").toString(),
			).sub;
			if (requestOwner === user.id)
				memberNames.set(requestOwner, user.user_metadata.full_name);
			const postingAccount = {
				id: requestOwner,
				name: memberNames.get(requestOwner) || "Recordly member",
			};
			postRequests.push({ owner: requestOwner, ...route.request().postDataJSON() });
			if (postGate) await postGate;
			const body = route.request().postDataJSON();
			posts.push(body);
			expect(body).not.toHaveProperty("author_name");
			if (postStatus !== 200)
				return route.fulfill({ status: postStatus, json: { error: "Fixture rejection" } });
			const item = {
				id: comments.length + 1,
				...body,
				owner: postingAccount.id,
				author_name: postingAccount.name,
				created_at: video.created_at,
			};
			comments.push(item);
			return route.fulfill({ json: { id: item.id, author_name: item.author_name } });
		}
		return route.fulfill({ status: 404, body: "" });
	});
	await page.goto(`${base}/share`);
	await expect(page.getByText("Sign in with your Recordly account to comment.")).toBeVisible();
	await expect(page.getByLabel("Comment", { exact: true })).toBeHidden();
	await expect(page.getByRole("heading", { name: video.title })).toBeVisible();
	await page.screenshot({ animations: "disabled", path: `${outputDir}/desktop-guest.png` });
	await page.getByRole("button", { name: "Sign in or create account" }).click();
	const dialog = page.getByRole("dialog", { name: "Sign in to Recordly" });
	await expect(dialog).toBeVisible();
	await page.screenshot({ animations: "disabled", path: `${outputDir}/desktop-signin.png` });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ animations: "disabled", path: `${outputDir}/mobile-signin.png` });
	await page.getByRole("button", { name: "Close sign-in", exact: true }).click();
	await expect(dialog).toBeHidden();
	await openFeedback();
	await page.getByRole("button", { name: "Sign in or create account" }).click();
	await expect(dialog).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.getByRole("button", { name: "Or use password to sign in" }).click();
	await page.getByLabel("Email", { exact: true }).fill(user.email);
	await page.getByLabel("Password", { exact: true }).fill("fixture-password");
	await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText("Choose a display name before commenting.")).toBeVisible();
	await expect(page.getByLabel("Comment", { exact: true })).toBeHidden();
	await page.getByLabel("Display name", { exact: true }).fill("Alex Reviewer");
	await page.screenshot({ animations: "disabled", path: `${outputDir}/desktop-choose-name.png` });
	await page.getByRole("button", { name: "Save name", exact: true }).click();
	await expect(page.getByText("Could not save your name. Please try again.")).toBeVisible();
	await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Alex Reviewer");
	nameStatus = 200;
	await page.getByRole("button", { name: "Save name", exact: true }).click();
	await expect(page.getByText("Commenting as")).toBeVisible();
	const composer = page.getByLabel("Comment", { exact: true });
	await composer.fill("Signed-in feedback");
	await page.getByRole("button", { name: "Post", exact: true }).click();
	await expect(page.getByText("Signed-in feedback", { exact: true })).toBeVisible();
	await expect(composer).toHaveValue("");
	comments.push({
		id: 41,
		timestamp: 12,
		owner: "other-account",
		author_name: "Other reviewer",
		text: "Someone else’s comment",
		created_at: video.created_at,
	});
	comments.push({
		id: 42,
		timestamp: 18,
		author_name: "Old guest",
		text: "Legacy guest comment",
		created_at: video.created_at,
	});
	await page.reload();
	await expect(page.getByText("Someone else’s comment", { exact: true })).toBeVisible();
	const own = page.locator("article.comment-item").filter({ hasText: "Signed-in feedback" });
	const other = page
		.locator("article.comment-item")
		.filter({ hasText: "Someone else’s comment" });
	await expect(other.getByRole("button", { name: "Edit your comment", exact: true })).toHaveCount(
		0,
	);
	await expect(
		other.getByRole("button", { name: "Delete your comment", exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Edit your comment", exact: true })).toHaveCount(
		1,
	);
	await own.getByRole("button", { name: "Edit your comment", exact: true }).click();
	const editDialog = page.getByRole("dialog", { name: "Edit your comment", exact: true });
	await editDialog.getByLabel("Edit comment", { exact: true }).fill("Corrected feedback");
	await page.screenshot({
		animations: "disabled",
		path: `${outputDir}/desktop-edit-comment.png`,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ animations: "disabled", path: `${outputDir}/mobile-edit-comment.png` });
	await page.setViewportSize({ width: 1280, height: 900 });
	mutationStatus = 503;
	await editDialog.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect(editDialog.getByText(/draft is still here/)).toBeVisible();
	await expect(editDialog.getByLabel("Edit comment", { exact: true })).toHaveValue(
		"Corrected feedback",
	);
	mutationStatus = 200;
	await editDialog.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect(editDialog).toBeHidden();
	await expect(page.getByText("Corrected feedback", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Delete your comment", exact: true }).click();
	const deleteDialog = page.getByRole("dialog", { name: "Delete your comment", exact: true });
	await deleteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByText("Corrected feedback", { exact: true })).toBeVisible();
	await composer.fill("Draft survives reload");
	await page.reload();
	await expect(composer).toHaveValue("Draft survives reload");
	postStatus = 401;
	await page.getByRole("button", { name: "Post", exact: true }).click();
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(composer).toHaveValue("Draft survives reload");
	await expect(page.getByText(/Your session expired/)).toBeVisible();
	postStatus = 429;
	await page.getByRole("button", { name: "Post", exact: true }).click();
	await expect(page.getByText(/commenting too quickly/)).toBeVisible();
	await expect(composer).toHaveValue("Draft survives reload");
	await page.setViewportSize({ width: 390, height: 844 });
	await openFeedback();
	await expect(composer).toBeVisible();
	await page.screenshot({ animations: "disabled", path: `${outputDir}/mobile-account.png` });
	await page
		.locator("video")
		.evaluate((video) =>
			Object.defineProperty(video, "duration", { configurable: true, value: 60 }),
		);
	await page.getByRole("button", { name: "Jump to 0:00", exact: true }).click();
	await expect(page.locator(".recording-app")).toHaveAttribute("data-mobile-view", "watch");
	await openFeedback();
	feedbackEnabled = false;
	await page.reload();
	await page.getByRole("button", { name: "Comments", exact: true }).click();
	await expect(page.getByRole("button", { name: "Edit your comment", exact: true })).toHaveCount(
		0,
	);
	await page.getByRole("button", { name: "Delete your comment", exact: true }).click();
	await deleteDialog.getByRole("button", { name: "Delete comment", exact: true }).click();
	await expect(deleteDialog).toBeHidden();
	await expect(page.getByText("Corrected feedback", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Someone else’s comment", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Delete your comment", exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Sign in or create account" })).toBeVisible();
	await expect(composer).toBeHidden();
	await page.screenshot({ animations: "disabled", path: `${outputDir}/mobile-guest.png` });
	feedbackEnabled = false;
	comments = [];
	commentsStatus = 503;
	await page.reload();
	await page.getByRole("button", { name: "Comments", exact: true }).click();
	await expect(page.getByText(/Comments could not be loaded/)).toBeVisible();
	await expect(page.getByRole("heading", { name: "No comments yet" })).toBeVisible();
	await expect(page.getByText("Start the conversation")).toHaveCount(0);
	expect(posts).toHaveLength(3);
	expect(pageErrors).toEqual([]);
	// Self-hosted instances use their own accounts and fail honestly on logout errors.
	await page.route("**/cloud/config", (route) => route.fulfill({ status: 404, json: {} }));
	let localUser = null;
	let logoutStatus = 500;
	await page.route(`${base}/auth/**`, (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/auth/login") {
			localUser = { displayName: "Local reviewer", email: "local@example.test" };
			return route.fulfill({ json: { user: localUser } });
		}
		if (path === "/auth/logout") {
			if (logoutStatus === 200) localUser = null;
			return route.fulfill({ status: logoutStatus, json: {} });
		}
		return route.fulfill({ json: { user: localUser } });
	});
	feedbackEnabled = true;
	commentsStatus = 200;
	await page.reload();
	await openFeedback();
	await page.getByRole("button", { name: "Sign in or create account" }).click();
	const localDialog = page.getByRole("dialog", { name: "Sign in to comment" });
	await localDialog.getByLabel("Email", { exact: true }).fill("local@example.test");
	await localDialog.getByLabel("Password", { exact: true }).fill("fixture-password");
	await localDialog.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(localDialog).toBeHidden();
	await expect(page.getByText("Local reviewer", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await expect(page.getByText("Could not sign out. Try again.")).toBeVisible();
	await expect(page.getByText("Local reviewer", { exact: true })).toBeVisible();
	logoutStatus = 200;
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await expect(page.getByRole("button", { name: "Sign in or create account" })).toBeVisible();
	expect(pageErrors).toEqual([]);
	// Auth can change directly through another tab while requests are in flight.
	// Completing the ownership request during POST must keep only B's controls.
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.route("**/cloud/config", (route) =>
		route.fulfill({
			json: {
				url: "https://comment-fixture.supabase.co",
				publishableKey: "fixture-public-key",
				authCaptcha: { enabled: false },
			},
		}),
	);
	feedbackEnabled = true;
	postStatus = 200;
	commentsStatus = 200;
	user.id = "account-a";
	user.user_metadata.full_name = "Reviewer A";
	const makeToken = (id) =>
		`${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.fixture`;
	token = makeToken(user.id);
	comments = [
		{
			id: 101,
			owner: "account-a",
			timestamp: 0,
			author_name: "Reviewer A",
			text: "Account A original",
			created_at: video.created_at,
		},
		{
			id: 102,
			owner: "account-b",
			timestamp: 10,
			author_name: "Reviewer B",
			text: "Account B earlier",
			created_at: video.created_at,
		},
	];
	const savedSession = {
		...session,
		access_token: token,
		expires_at: Math.floor(Date.now() / 1000) + 3600,
	};
	await page.evaluate(
		(value) => localStorage.setItem("recordly-cloud-auth", JSON.stringify(value)),
		savedSession,
	);
	await page.reload();
	const articleA = page.locator("article.comment-item").filter({ hasText: "Account A original" });
	const articleB = page.locator("article.comment-item").filter({ hasText: "Account B earlier" });
	await expect(
		articleA.getByRole("button", { name: "Edit your comment", exact: true }),
	).toBeVisible();
	let releaseOwnership;
	ownershipGate = new Promise((resolve) => {
		releaseOwnership = resolve;
	});
	user.id = "account-b";
	user.user_metadata.full_name = "Reviewer B";
	token = makeToken(user.id);
	const switchedSession = {
		...session,
		access_token: token,
		expires_at: Math.floor(Date.now() / 1000) + 3600,
	};
	await page.evaluate((value) => {
		localStorage.setItem("recordly-cloud-auth", JSON.stringify(value));
		const channel = new BroadcastChannel("recordly-cloud-auth");
		channel.postMessage({ event: "SIGNED_IN", session: value });
		channel.close();
	}, switchedSession);
	await expect(page.getByText("Reviewer B", { exact: true }).last()).toBeVisible();
	await expect(
		articleA.getByRole("button", { name: "Edit your comment", exact: true }),
	).toHaveCount(0);
	let releasePost;
	postGate = new Promise((resolve) => {
		releasePost = resolve;
	});
	await composer.fill("Account B new");
	await page.getByRole("button", { name: "Post", exact: true }).click();
	await expect(page.getByRole("button", { name: "Posting…", exact: true })).toBeVisible();
	ownershipGate = null;
	releaseOwnership();
	await expect(
		articleB.getByRole("button", { name: "Edit your comment", exact: true }),
	).toBeVisible();
	postGate = null;
	releasePost();
	await expect(page.getByText("Account B new", { exact: true })).toBeVisible();
	await expect(
		articleB.getByRole("button", { name: "Edit your comment", exact: true }),
	).toBeVisible();
	await expect(
		articleA.getByRole("button", { name: "Edit your comment", exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Edit your comment", exact: true })).toHaveCount(
		2,
	);
	await page.screenshot({
		animations: "disabled",
		path: `${outputDir}/desktop-owned-actions.png`,
	});
	expect(pageErrors).toEqual([]);
	// An accepted B post remains public after switching to C. C's first list is
	// deliberately complete before insertion, so the successful mutation must
	// invalidate that otherwise-stale response and clear only the submitted draft.
	const beforeSwitchPost = comments.length;
	let releaseSwitchedPost;
	postGate = new Promise((resolve) => {
		releaseSwitchedPost = resolve;
	});
	await composer.fill("B post completes after switching account");
	await page.getByRole("button", { name: "Post", exact: true }).click();
	await expect(page.getByRole("button", { name: "Posting…", exact: true })).toBeVisible();
	await expect
		.poll(() =>
			postRequests.some(
				(item) =>
					item.owner === "account-b" &&
					item.text === "B post completes after switching account",
			),
		)
		.toBe(true);
	user.id = "account-c";
	user.user_metadata.full_name = "Reviewer C";
	token = makeToken(user.id);
	const thirdSession = {
		...session,
		access_token: token,
		expires_at: Math.floor(Date.now() / 1000) + 3600,
	};
	await page.evaluate((value) => {
		localStorage.setItem("recordly-cloud-auth", JSON.stringify(value));
		const channel = new BroadcastChannel("recordly-cloud-auth");
		channel.postMessage({ event: "SIGNED_IN", session: value });
		channel.close();
	}, thirdSession);
	await expect(page.getByText("Reviewer C", { exact: true }).last()).toBeVisible();
	await expect
		.poll(() =>
			commentReads.some(
				(read) =>
					read.authorization === `Bearer ${token}` && read.total === beforeSwitchPost,
			),
		)
		.toBe(true);
	postGate = null;
	releaseSwitchedPost();
	await expect(
		page.getByText("B post completes after switching account", { exact: true }),
	).toBeVisible();
	await expect(composer).toHaveValue("");
	await expect
		.poll(() =>
			page.evaluate(() => sessionStorage.getItem("recordly-comment-draft:fixture123")),
		)
		.toBeNull();
	await expect(page.getByRole("button", { name: "Edit your comment", exact: true })).toHaveCount(
		0,
	);
	expect(
		comments.find((item) => item.text === "B post completes after switching account")?.owner,
	).toBe("account-b");
	// Timestamp changes are a newer draft revision even when the text is equal.
	let releaseRevisedPost;
	postGate = new Promise((resolve) => {
		releaseRevisedPost = resolve;
	});
	await composer.fill("Keep the newer timestamp draft");
	await page.getByRole("button", { name: "Post", exact: true }).click();
	await expect(page.getByRole("button", { name: "Posting…", exact: true })).toBeVisible();
	await page.locator("video").evaluate((video) => {
		Object.defineProperty(video, "currentTime", { configurable: true, value: 15 });
		video.dispatchEvent(new Event("timeupdate"));
	});
	await page.getByRole("button", { name: /Comment timestamp.*Use current video time/ }).click();
	postGate = null;
	releaseRevisedPost();
	await expect(page.getByText("Keep the newer timestamp draft", { exact: true })).toBeVisible();
	await expect(composer).toHaveValue("Keep the newer timestamp draft");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(
						sessionStorage.getItem("recordly-comment-draft:fixture123") || "null",
					)?.time,
			),
		)
		.toBe(15);
	expect(pageErrors).toEqual([]);
	console.log(
		"PASS successful post survives account switch after the new account list completed; submitted draft clears, newer draft revision survives",
	);
	console.log("PASS cross-tab account switch with concurrent ownership listing and posting");
	console.log("PASS self-host account login/logout and failed logout handling");
	console.log(
		"PASS profile name requirement/save/retry, own-comment edit/failure draft/delete/cancel, foreign/legacy ownership and deletion with feedback disabled",
	);
	console.log(
		"PASS managed account sign-in/post, no guest composer, private email, draft reload, 401 recovery, throttle draft, sign-out, desktop/mobile and disabled feedback error",
	);
} finally {
	await browser?.close();
	server.kill("SIGTERM");
}
