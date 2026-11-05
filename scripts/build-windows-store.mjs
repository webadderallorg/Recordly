import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Fail before building native helpers if the product identity is unavailable.
require("../electron-builder.store.cjs")();
if (process.platform !== "win32" || process.arch !== "x64") {
	throw new Error(
		"Build the Store package on Windows x64 (see the Microsoft Store package workflow).",
	);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(
	process.env.ComSpec || "cmd.exe",
	[
		"/d",
		"/s",
		"/c",
		"npm run build:win -- --x64 --config electron-builder.store.cjs --publish never",
	],
	{
		cwd: root,
		stdio: "inherit",
		env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
	},
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
