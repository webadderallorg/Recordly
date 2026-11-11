import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { updateNativeHelperManifest } from "./native-helper-manifest.mjs";

const projectRoot = process.cwd();
const x64Dir = path.join(projectRoot, "electron", "native", "bin", "win32-x64");
const arm64Dir = path.join(projectRoot, "electron", "native", "bin", "win32-arm64");

mkdirSync(arm64Dir, { recursive: true });

const filesToCopy = [
	"wgc-capture.exe",
	"cursor-monitor.exe",
	"recordly-gpu-export.exe",
	"whisper-cli.exe",
	"whisper.dll",
	"ggml.dll",
	"ggml-cpu.dll",
	"ggml-base.dll",
	"SDL2.dll",
];

for (const file of filesToCopy) {
	const src = path.join(x64Dir, file);
	const dst = path.join(arm64Dir, file);
	if (existsSync(src)) {
		copyFileSync(src, dst);
		console.log(`Copied ${file} -> win32-arm64/`);
	} else {
		console.warn(`Source file missing: ${src}`);
	}
}

// Write whisper-runtime.json
const whisperRuntime = {
	version: "v1.8.4",
	platform: "win32",
	arch: "arm64",
	binary: "whisper-cli.exe",
};
writeFileSync(
	path.join(arm64Dir, "whisper-runtime.json"),
	JSON.stringify(whisperRuntime, null, 2),
	"utf8",
);
console.log("Wrote win32-arm64/whisper-runtime.json");

// Update helpers-manifest.json for arm64
const helpers = [
	{
		helperId: "wgc-capture",
		sourceDir: path.join(projectRoot, "electron", "native", "wgc-capture"),
		binaryName: "wgc-capture.exe",
	},
	{
		helperId: "cursor-monitor",
		sourceDir: path.join(projectRoot, "electron", "native", "cursor-monitor"),
		binaryName: "cursor-monitor.exe",
	},
	{
		helperId: "recordly-gpu-export",
		sourceDir: path.join(projectRoot, "electron", "native", "gpu-export-probe"),
		binaryName: "recordly-gpu-export.exe",
	},
];

for (const h of helpers) {
	const binaryPath = path.join(arm64Dir, h.binaryName);
	updateNativeHelperManifest({
		projectRoot,
		helperId: h.helperId,
		sourceDir: h.sourceDir,
		binaryPath,
		binaryName: h.binaryName,
		platform: "win32",
		arch: "arm64",
	});
	console.log(`Updated manifest entry for ${h.helperId} (win32-arm64)`);
}

console.log("Staging for win32-arm64 complete!");
