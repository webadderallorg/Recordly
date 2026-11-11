import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const projectRoot = process.cwd();
const nodeModulesFfmpeg = path.join(projectRoot, "node_modules", "ffmpeg-static", "ffmpeg.exe");
const nodeModulesFfprobe = path.join(projectRoot, "node_modules", "ffprobe-static", "bin", "win32", "arm64", "ffprobe.exe");
const tmpBinDir = path.join(projectRoot, "..", ".tmp", "ffmpeg-arm64-bin");
const localTmpBinDir = path.join(projectRoot, ".tmp", "ffmpeg-arm64-bin");

let arm64Ffmpeg = null;
let arm64Ffprobe = null;

if (existsSync(nodeModulesFfmpeg) && existsSync(nodeModulesFfprobe)) {
	arm64Ffmpeg = nodeModulesFfmpeg;
	arm64Ffprobe = nodeModulesFfprobe;
} else if (existsSync(path.join(tmpBinDir, "ffmpeg.exe"))) {
	arm64Ffmpeg = path.join(tmpBinDir, "ffmpeg.exe");
	arm64Ffprobe = path.join(tmpBinDir, "ffprobe.exe");
} else if (existsSync(path.join(localTmpBinDir, "ffmpeg.exe"))) {
	arm64Ffmpeg = path.join(localTmpBinDir, "ffmpeg.exe");
	arm64Ffprobe = path.join(localTmpBinDir, "ffprobe.exe");
}

if (!arm64Ffmpeg) {
	console.error("[setup-arm64] ARM64 ffmpeg.exe and ffprobe.exe not found.");
	process.exit(1);
}

console.log("[setup-arm64] Using native ARM64 FFmpeg:", arm64Ffmpeg);

// 1. Setup ffmpeg-static
const ffmpegStaticDir = path.join(projectRoot, "node_modules", "ffmpeg-static");
if (existsSync(ffmpegStaticDir)) {
	const ffmpegStaticIndex = path.join(ffmpegStaticDir, "index.js");
	let indexContent = readFileSync(ffmpegStaticIndex, "utf8");
	if (!indexContent.includes("'arm64'") || !indexContent.includes("win32: ['x64', 'ia32', 'arm64']")) {
		indexContent = indexContent.replace(
			"win32: ['x64', 'ia32']",
			"win32: ['x64', 'ia32', 'arm64']",
		);
		writeFileSync(ffmpegStaticIndex, indexContent, "utf8");
		console.log("[setup-arm64] Patched ffmpeg-static/index.js to support win32 arm64");
	}

	const ffmpegStaticExe = path.join(ffmpegStaticDir, "ffmpeg.exe");
	copyFileSync(arm64Ffmpeg, ffmpegStaticExe);
	console.log(`[setup-arm64] Staged native ARM64 ffmpeg -> ${ffmpegStaticExe}`);
} else {
	console.warn("[setup-arm64] node_modules/ffmpeg-static not found yet (run after npm install)");
}

// 2. Setup ffprobe-static
const ffprobeStaticDir = path.join(projectRoot, "node_modules", "ffprobe-static");
if (existsSync(ffprobeStaticDir)) {
	const arm64TargetDir = path.join(ffprobeStaticDir, "bin", "win32", "arm64");
	mkdirSync(arm64TargetDir, { recursive: true });
	const ffprobeStaticExe = path.join(arm64TargetDir, "ffprobe.exe");
	copyFileSync(arm64Ffprobe, ffprobeStaticExe);
	console.log(`[setup-arm64] Staged native ARM64 ffprobe -> ${ffprobeStaticExe}`);

	// Also ensure win32/x64 exists if ffprobe-static expects it
	const x64TargetDir = path.join(ffprobeStaticDir, "bin", "win32", "x64");
	mkdirSync(x64TargetDir, { recursive: true });
	const x64Ffprobe = path.join(x64TargetDir, "ffprobe.exe");
	if (!existsSync(x64Ffprobe)) {
		copyFileSync(arm64Ffprobe, x64Ffprobe);
	}
} else {
	console.warn("[setup-arm64] node_modules/ffprobe-static not found yet (run after npm install)");
}

// 3. Setup uiohook-napi
const uiohookDir = path.join(projectRoot, "node_modules", "uiohook-napi");
if (existsSync(uiohookDir)) {
	const arm64Prebuild = path.join(uiohookDir, "prebuilds", "win32-arm64", "uiohook-napi.node");
	const altPrebuild = path.join(uiohookDir, "prebuilds", "win32-arm64", "node.napi.node");
	const releaseTarget = path.join(uiohookDir, "build", "Release", "uiohook_napi.node");

	const prebuildSource = existsSync(arm64Prebuild)
		? arm64Prebuild
		: existsSync(altPrebuild)
			? altPrebuild
			: null;

	if (prebuildSource) {
		mkdirSync(path.dirname(releaseTarget), { recursive: true });
		copyFileSync(prebuildSource, releaseTarget);
		console.log(`[setup-arm64] Staged uiohook-napi win32-arm64 -> ${releaseTarget}`);
	}
}

// 4. Ensure win32-arm64 helpers are staged
try {
	execFileSync(process.execPath, [path.join(projectRoot, "scripts", "stage-win32-arm64-helpers.mjs")], {
		stdio: "inherit",
	});
} catch (e) {
	console.warn("[setup-arm64] Warning staging win32-arm64 helpers:", e.message);
}

console.log("[setup-arm64] ARM64 media tools and native helpers configured successfully!");
