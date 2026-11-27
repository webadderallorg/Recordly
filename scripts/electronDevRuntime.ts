import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export function getElectronDevArgs(): string[] {
	const args = [".", "--no-sandbox"];
	if (process.platform === "darwin" && Number.parseInt(os.release(), 10) >= 27) {
		// macOS registers Chromium's camera utility as a foreground app, even
		// when it just enumerates devices. In-process capture uses shared memory.
		args.push(
			"--enable-features=RunVideoCaptureServiceInBrowserProcess",
			"--disable-video-capture-use-gpu-memory-buffer",
		);
	}
	return args;
}

/** Restore the launch metadata changed by earlier Recordly dev runs. */
export function prepareElectronDevRuntime(projectRoot: string): void {
	if (process.platform !== "darwin") return;
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
	if (current.status !== 0 || current.stdout.trim() !== "true") return;
	const result = spawnSync("/usr/bin/plutil", ["-remove", "LSUIElement", infoPlist], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(
			`Could not configure macOS Electron launch identity: ${result.stderr || result.error}`,
		);
	}
}
