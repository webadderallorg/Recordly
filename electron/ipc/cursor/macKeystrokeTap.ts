import { createRequire } from "node:module";
import { ensureKeystrokeTapBinary } from "../paths/binaries";
import { recordKeystrokeFromMonitorLine } from "./keystrokes";

const nodeRequire = createRequire(import.meta.url);

type KeystrokeTapAddon = {
	start: (onLine: (line: string) => void) => boolean;
	stop: () => boolean;
};

let loadedAddon: KeystrokeTapAddon | null = null;
let loadedAddonPath: string | null = null;

async function loadAddon() {
	const addonPath = await ensureKeystrokeTapBinary();
	if (loadedAddon && loadedAddonPath === addonPath) {
		return loadedAddon;
	}
	delete nodeRequire.cache[addonPath];
	loadedAddon = nodeRequire(addonPath) as KeystrokeTapAddon;
	loadedAddonPath = addonPath;
	return loadedAddon;
}

export async function startInProcessKeystrokeTap() {
	const addon = await loadAddon();
	addon.stop();
	return addon.start((line) => {
		if (line.startsWith("KEY:")) {
			recordKeystrokeFromMonitorLine(line);
		}
	});
}

export function stopInProcessKeystrokeTap() {
	loadedAddon?.stop();
}

export async function probeInProcessKeystrokeTap() {
	return await startInProcessKeystrokeTap();
}
