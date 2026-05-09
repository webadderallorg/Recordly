import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	findElectronMainCjsEsmSyntax,
	normalizeElectronMainCjs,
} from "./normalize-electron-main-cjs.mjs";

const mainBundleUrl = new URL("../dist-electron/main.cjs", import.meta.url);
const mainBundlePath = fileURLToPath(mainBundleUrl);

const { source } = await normalizeElectronMainCjs(mainBundleUrl);
const matches = findElectronMainCjsEsmSyntax(source);

if (matches.length > 0) {
	const details = matches.map((match) => `line ${match.line}: ${match.text}`).join("\n");
	throw new Error(`dist-electron/main.cjs contains ESM import syntax:\n${details}`);
}

const checkResult = spawnSync(process.execPath, ["--check", mainBundlePath], {
	encoding: "utf8",
});

if (checkResult.status !== 0) {
	const details = [checkResult.stdout, checkResult.stderr].filter(Boolean).join("\n");
	throw new Error(
		`dist-electron/main.cjs does not parse as CommonJS:${details ? `\n${details}` : ""}`,
	);
}

console.log(`Electron main CJS smoke passed: ${mainBundlePath}`);
