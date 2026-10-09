import { execFile } from "node:child_process";

export const MAC_DND_ON_SHORTCUT = "Recordly Do Not Disturb On";
export const MAC_DND_OFF_SHORTCUT = "Recordly Do Not Disturb Off";
const WIN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings";
const WIN_VALUE = "NOC_GLOBAL_SETTING_TOASTS_ENABLED";
const COMMAND_TIMEOUT_MS = 8000;

export type DoNotDisturbResult = {
	ok: boolean;
	enabled?: boolean;
	message: string;
};

export type DoNotDisturbDeps = {
	platform: NodeJS.Platform;
	run: (command: string, args: string[]) => Promise<string>;
};

type Driver = {
	read: () => Promise<boolean | null>;
	write: (on: boolean) => Promise<void>;
	manual: string;
};

const defaultDeps: DoNotDisturbDeps = {
	platform: process.platform,
	run: (command, args) =>
		new Promise((resolve, reject) =>
			execFile(
				command,
				args,
				{ timeout: COMMAND_TIMEOUT_MS, killSignal: "SIGKILL" },
				(error, stdout, stderr) => {
					if (!error) return resolve(String(stdout));
					reject(
						new Error(
							error.killed
								? `${command} did not finish within ${COMMAND_TIMEOUT_MS / 1000} s and was stopped`
								: String(stderr || error.message).trim(),
						),
					);
				},
			),
		),
};

function createDriver(deps: DoNotDisturbDeps): Driver | null {
	const { run } = deps;
	switch (deps.platform) {
		case "darwin":
			return {
				// Reading the Focus state needs Full Disk Access.
				read: async () => null,
				write: async (on) => {
					const name = on ? MAC_DND_ON_SHORTCUT : MAC_DND_OFF_SHORTCUT;
					try {
						await run("shortcuts", ["run", name]);
					} catch (error) {
						const detail = error instanceof Error ? error.message : String(error);
						throw new Error(
							/couldn.?t find|not found/i.test(detail)
								? `the Shortcut "${name}" does not exist. Create Shortcuts named "${MAC_DND_ON_SHORTCUT}" and "${MAC_DND_OFF_SHORTCUT}", each with one "Set Focus" action`
								: detail,
						);
					}
				},
				manual: "set it yourself in Control Centre",
			};
		case "win32":
			return {
				read: async () => {
					const out = await run("reg", ["query", WIN_KEY, "/v", WIN_VALUE]).catch(
						() => "",
					);
					const match = out.match(/REG_DWORD\s+0x([0-9a-f]+)/i);
					// Missing value means banners are on (the Windows default).
					return match ? Number.parseInt(match[1], 16) === 0 : false;
				},
				write: async (on) => {
					await run("reg", [
						"add",
						WIN_KEY,
						"/v",
						WIN_VALUE,
						"/t",
						"REG_DWORD",
						"/d",
						on ? "0" : "1",
						"/f",
					]);
				},
				manual: "turn on Do Not Disturb in Windows notification settings yourself",
			};
		case "linux": {
			const schema = ["org.gnome.desktop.notifications", "show-banners"];
			return {
				read: async () => (await run("gsettings", ["get", ...schema])).trim() === "false",
				write: async (on) => {
					await run("gsettings", ["set", ...schema, on ? "false" : "true"]);
				},
				manual: "turn off notification banners in your desktop's settings yourself",
			};
		}
		default:
			return null;
	}
}

let saved: { previous: boolean | null } | null = null;

const failure = (reason: string, manual: string): DoNotDisturbResult => ({
	ok: false,
	message: `Could not change Do Not Disturb — ${manual}. (${reason})`,
});

let queue: Promise<unknown> = Promise.resolve();

export function setDoNotDisturb(
	enabled: boolean,
	deps: DoNotDisturbDeps = defaultDeps,
): Promise<DoNotDisturbResult> {
	const result = queue.then(() => applyDoNotDisturb(enabled, deps));
	queue = result.catch(() => undefined);
	return result;
}

async function applyDoNotDisturb(
	enabled: boolean,
	deps: DoNotDisturbDeps,
): Promise<DoNotDisturbResult> {
	const driver = createDriver(deps);
	if (!driver) {
		return failure(
			`this platform (${deps.platform}) is not supported`,
			"set it yourself in your system settings",
		);
	}
	try {
		if (enabled) {
			const previous = saved ? saved.previous : await driver.read().catch(() => null);
			await driver.write(true);
			saved ??= { previous };
			return {
				ok: true,
				enabled: true,
				message:
					deps.platform === "darwin"
						? "Do Not Disturb was switched on through your Shortcut. macOS does not let Recordly confirm it, so check the menu bar."
						: "Do Not Disturb is on.",
			};
		}
		const target = saved?.previous ?? false;
		await driver.write(target);
		saved = null;
		return {
			ok: true,
			enabled: target,
			message: target
				? "Do Not Disturb was already on before Recordly, so it was left on."
				: "Do Not Disturb is off.",
		};
	} catch (error) {
		return failure(error instanceof Error ? error.message : String(error), driver.manual);
	}
}

export async function restoreDoNotDisturb(
	deps?: DoNotDisturbDeps,
): Promise<DoNotDisturbResult | null> {
	return saved ? setDoNotDisturb(false, deps) : null;
}

export function hasChangedDoNotDisturb(): boolean {
	return saved !== null;
}
