import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/** Keep media helpers out of the Dock without changing Electron's executable identity. */
export function prepareElectronDevRuntime(projectRoot: string): undefined {
	if (process.platform !== "darwin") return undefined;
	const require = createRequire(path.join(projectRoot, "package.json"));
	const executable = require("electron") as string;
	const infoPlist = path.resolve(path.dirname(executable), "..", "Info.plist");
	const current = spawnSync(
		"/usr/bin/plutil",
		["-extract", "LSUIElement", "raw", "-o", "-", infoPlist],
		{
			encoding: "utf8",
		},
	);
	if (current.status === 0 && current.stdout.trim() === "true") return undefined;
	// The npm Electron runtime's Info.plist is unbound. Change only this launch
	// metadata, preserving the original binary signature, path and Keychain grant.
	// desktopPresence restores the main app's normal Dock icon after ready.
	const result = spawnSync(
		"/usr/bin/plutil",
		["-replace", "LSUIElement", "-bool", "YES", infoPlist],
		{
			encoding: "utf8",
		},
	);
	if (result.status !== 0) {
		throw new Error(
			`Could not configure macOS Electron launch identity: ${result.stderr || result.error}`,
		);
	}
	return undefined;
}
