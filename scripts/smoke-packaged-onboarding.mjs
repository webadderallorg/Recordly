import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const executablePath = process.argv[2];
if (!executablePath) {
	throw new Error(
		"Usage: npm run smoke:packaged-onboarding -- <path-to-packaged-Recordly-executable>",
	);
}

const profile = await mkdtemp(path.join(await realpath(tmpdir()), "recordly-onboarding-smoke-"));
const settingsPath = path.join(profile, "app-settings.json");
const debugPortPath = path.join(profile, "DevToolsActivePort");
const introKey = "recordly.onboarding.introStarted";
const pendingKey = "recordly.onboarding.permissionsRequested";
const completedKey = "recordly.onboarding.v1.seen";
const readSettings = async () => JSON.parse(await readFile(settingsPath, "utf8"));
const writeSettings = (settings) => writeFile(settingsPath, JSON.stringify(settings));

async function checkStartup(label, freshInstall) {
	await rm(debugPortPath, { force: true });
	// Use a loopback renderer connection. The release build disables the Node inspector.
	const app = spawn(
		path.resolve(executablePath),
		[
			`--user-data-dir=${profile}`,
			"--lang=en",
			"--mute-audio",
			"--remote-debugging-address=127.0.0.1",
			"--remote-debugging-port=0",
		],
		{ env: { ...process.env, RECORDLY_DISABLE_AUTO_UPDATES: "1" }, stdio: "inherit" },
	);
	await once(app, "spawn");
	const exited = once(app, "exit");
	let browser;
	try {
		let endpoint;
		await expect
			.poll(
				async () => {
					if (app.exitCode !== null || app.signalCode !== null)
						throw new Error("Recordly exited before its renderer became available");
					const contents = await readFile(debugPortPath, "utf8").catch((error) => {
						if (error.code !== "ENOENT") throw error;
						return "";
					});
					const [port, socket] = contents.trim().split(/\r?\n/);
					endpoint =
						/^\d+$/.test(port) && /^\/devtools\/browser\/[a-f0-9-]+$/.test(socket)
							? `ws://127.0.0.1:${port}${socket}`
							: undefined;
					return Boolean(endpoint);
				},
				{ message: label, timeout: 30_000 },
			)
			.toBe(true);
		browser = await chromium.connectOverCDP(endpoint);

		// Observe the window Electron chose; don't navigate directly to the tour.
		const findOnboarding = () =>
			browser
				.contexts()
				.flatMap((context) => context.pages())
				.find(
					(page) => new URL(page.url()).searchParams.get("windowType") === "onboarding",
				);
		await expect
			.poll(() => Boolean(findOnboarding()), { message: label, timeout: 30_000 })
			.toBe(true);
		const onboarding = findOnboarding();
		const query = new URL(onboarding.url()).searchParams;
		expect(query.get("startup"), label).toBe("1");
		const expectIntro =
			freshInstall && (process.platform === "darwin" || process.platform === "win32");
		expect(query.get("welcomeSoundtrack"), label).toBe(expectIntro ? "intro" : null);
		const welcome = onboarding.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(welcome).toBeVisible({ timeout: 30_000 });
		await expect(welcome.getByRole("button", { name: "Continue as guest" })).toBeEnabled();
		const navigation = welcome.getByRole("navigation");
		await expect(
			navigation.getByRole("button", { name: "Account", exact: true }),
		).toHaveAttribute("aria-current", "page");
		if (process.platform === "darwin") {
			await expect(
				navigation.getByRole("button", { name: "Permissions", exact: true }),
			).toBeVisible();
		}
	} finally {
		const gracePeriod = browser ? 5_000 : 0;
		const terminateTimer = setTimeout(() => app.kill(), gracePeriod);
		const killTimer = setTimeout(() => app.kill("SIGKILL"), gracePeriod + 5_000);
		try {
			if (browser?.isConnected()) {
				// Electron quits through its normal lifecycle without replying to Browser.close.
				void browser
					.newBrowserCDPSession()
					.then((session) => session.send("Browser.close"))
					.catch(() => undefined);
			}
			await exited;
		} finally {
			clearTimeout(terminateTimer);
			clearTimeout(killTimer);
			await browser?.close();
		}
	}
	expect(app.exitCode, `${label} shut down cleanly`).toBe(0);
	console.log(`[packaged-onboarding] ${label}: passed`);
}

try {
	await writeSettings({ "recordly.locale": "en" });
	await checkStartup("Clean first run", true);
	const firstRun = await readSettings();
	if (process.platform === "darwin" || process.platform === "win32")
		expect(firstRun[introKey]).toEqual(expect.any(String));
	expect(firstRun[completedKey]).not.toBe(true);

	await writeSettings({ ...firstRun, [pendingKey]: true });
	await checkStartup("Relaunch with permission setup pending", false);
	const interrupted = await readSettings();
	expect(interrupted[pendingKey]).toBe(true);
	expect(interrupted[completedKey]).not.toBe(true);

	await writeSettings({ ...interrupted, [pendingKey]: false, [completedKey]: true });
	await checkStartup("Existing profile on the same installation", false);
	await writeSettings({
		...interrupted,
		[pendingKey]: false,
		[completedKey]: true,
		[introKey]: "older-installation",
	});
	await checkStartup("Existing profile on a fresh installation", true);
} finally {
	await rm(profile, { recursive: true, force: true });
}
