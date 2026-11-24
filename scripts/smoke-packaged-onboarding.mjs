import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect } from "@playwright/test";

const executablePath = process.argv[2];
if (!executablePath) {
	throw new Error(
		"Usage: npm run smoke:packaged-onboarding -- <path-to-packaged-Recordly-executable>",
	);
}

const profile = await mkdtemp(path.join(await realpath(tmpdir()), "recordly-onboarding-smoke-"));
const settingsPath = path.join(profile, "app-settings.json");
const introKey = "recordly.onboarding.introStarted";
const pendingKey = "recordly.onboarding.permissionsRequested";
const completedKey = "recordly.onboarding.v1.seen";
const readSettings = async () => JSON.parse(await readFile(settingsPath, "utf8"));
const writeSettings = (settings) => writeFile(settingsPath, JSON.stringify(settings));

async function checkStartup(label, freshInstall) {
	const app = await electron.launch({
		executablePath: path.resolve(executablePath),
		args: [`--user-data-dir=${profile}`, "--lang=en", "--mute-audio"],
		env: { ...process.env, RECORDLY_DISABLE_AUTO_UPDATES: "1" },
	});
	try {
		expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
		expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(profile);

		// Observe the window Electron chose; don't navigate directly to the tour.
		const findOnboarding = () =>
			app
				.windows()
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
		console.log(`[packaged-onboarding] ${label}: passed`);
	} finally {
		await app.close();
	}
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
