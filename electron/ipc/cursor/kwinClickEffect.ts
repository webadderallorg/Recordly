import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { nextKwinObjectName } from "./kwinCursorBridge";

const execFileAsync = promisify(execFile);

const KWIN_CLICK_EFFECT_ID = "recordly_click_bridge";
// Qt::MouseButton flags mapped to the hook's 1 = left, 2 = right, 3 = middle.
const QT_BUTTON_TO_HOOK_BUTTON: Array<[number, 1 | 2 | 3]> = [
	[1, 1],
	[2, 2],
	[4, 3],
];

export function diffKwinButtons(buttons: number, oldButtons: number) {
	const pressed: Array<1 | 2 | 3> = [];
	let released = 0;

	for (const [flag, hookButton] of QT_BUTTON_TO_HOOK_BUTTON) {
		const isDown = (buttons & flag) !== 0;
		const wasDown = (oldButtons & flag) !== 0;
		if (isDown && !wasDown) {
			pressed.push(hookButton);
		} else if (!isDown && wasDown) {
			released += 1;
		}
	}

	return { pressed, released };
}

export const KWIN_CLICK_JOURNAL_MARKER = "RECORDLY_BUTTONS";

// KWin scripts cannot see mouse buttons, but effects receive every pointer
// state change, which is the only click source on a Wayland session. Effects
// have no D-Bus access, so they report through KWin's journal output.
export function buildKwinClickEffectScript(): string {
	return `effects.mouseChanged.connect(function (pos, oldPos, buttons, oldButtons) {
	if (buttons !== oldButtons) {
		print("${KWIN_CLICK_JOURNAL_MARKER} " + buttons + " " + oldButtons);
	}
});
`;
}

/** Parses followed journal output into the button transitions printed by the effect. */
export function createKwinJournalButtonsParser(
	onButtons: (buttons: number, oldButtons: number) => void,
) {
	const pattern = new RegExp(`${KWIN_CLICK_JOURNAL_MARKER} (\\d+) (\\d+)\\s*$`);
	let buffer = "";

	return (chunk: string) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const match = line.match(pattern);
			if (match) {
				onButtons(Number(match[1]), Number(match[2]));
			}
		}
	};
}

function callKwinEffects(method: "loadEffect" | "unloadEffect", effectId: string) {
	return execFileAsync(
		"gdbus",
		[
			"call",
			"--session",
			"--dest",
			"org.kde.KWin",
			"--object-path",
			"/Effects",
			"--method",
			`org.kde.kwin.Effects.${method}`,
			effectId,
		],
		{ timeout: 3000 },
	);
}

/** Streams global mouse button changes from a temporary KWin effect. Resolves with a stop function. */
export async function startKwinClickEffect(
	onButtons: (buttons: number, oldButtons: number) => void,
	env: NodeJS.ProcessEnv = process.env,
): Promise<() => void> {
	const effectId = nextKwinObjectName(KWIN_CLICK_EFFECT_ID, "_");
	const dataHome = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
	const effectDir = path.join(dataHome, "kwin", "effects", effectId);
	const monitor = spawn("journalctl", ["--user", "--follow", "--lines=0", "--output=cat"], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	monitor.on("error", () => undefined);
	const stop = () => {
		monitor.kill();
		void callKwinEffects("unloadEffect", effectId)
			.catch(() => undefined)
			.then(() => fs.rm(effectDir, { recursive: true, force: true }))
			.catch(() => undefined);
	};

	try {
		monitor.stdout?.setEncoding("utf-8");
		monitor.stdout?.on("data", createKwinJournalButtonsParser(onButtons));

		await fs.mkdir(path.join(effectDir, "contents", "code"), { recursive: true });
		await fs.writeFile(
			path.join(effectDir, "metadata.json"),
			JSON.stringify({
				KPackageStructure: "KWin/Effect",
				KPlugin: {
					Id: effectId,
					Name: "Recordly click bridge",
					Version: "1.0",
				},
				"X-Plasma-API": "javascript",
				"X-Plasma-MainScript": "code/main.js",
			}),
			"utf-8",
		);
		await fs.writeFile(
			path.join(effectDir, "contents", "code", "main.js"),
			buildKwinClickEffectScript(),
			"utf-8",
		);
		await callKwinEffects("unloadEffect", effectId).catch(() => undefined);
		const { stdout } = await callKwinEffects("loadEffect", effectId);
		if (!stdout.includes("true")) {
			throw new Error(`KWin refused the click effect: ${stdout.trim()}`);
		}
	} catch (error) {
		stop();
		throw error;
	}

	return stop;
}
