import { spawnSync } from "node:child_process";

const npmExecPath = process.env.npm_execpath;
const hasNpmExecPath = typeof npmExecPath === "string" && npmExecPath.length > 0;
const npmInvoker = hasNpmExecPath
	? {
			command: process.execPath,
			argsPrefix: [npmExecPath],
			shell: false,
		}
	: {
			command: process.platform === "win32" ? "npm.cmd" : "npm",
			argsPrefix: [],
			shell: process.platform === "win32",
		};

function runScript(scriptName) {
	console.log(`[postinstall] Running npm script: ${scriptName}`);
	const result = spawnSync(npmInvoker.command, [...npmInvoker.argsPrefix, "run", scriptName], {
		stdio: "inherit",
		env: process.env,
		shell: npmInvoker.shell,
	});

	if (result.error) {
		console.error(`[postinstall] Failed to start "${scriptName}" (${result.error.message}).`);
		return false;
	}

	if (result.signal) {
		console.error(`[postinstall] "${scriptName}" was terminated by signal ${result.signal}.`);
		return false;
	}

	if (result.status !== 0) {
		console.error(`[postinstall] "${scriptName}" exited with code ${result.status}.`);
		return false;
	}

	return true;
}

const rebuildOk = runScript("rebuild:native");
if (!rebuildOk) {
	console.warn("[postinstall] Native C++ rebuild skipped or failed; using bundled/prebuilt binaries.");
}

runScript("setup:arm64");

if (!runScript("build:platform-native-helpers")) {
	process.exit(1);
}
