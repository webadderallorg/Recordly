import { spawnSync } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const nativeRoot = path.join(projectRoot, "electron", "native");
const moduleCacheRoot = path.join(os.tmpdir(), "recordly-swift-module-cache");

if (process.platform !== "darwin") {
	console.log("[build-native-helpers] Skipping: host platform is not macOS.");
	process.exit(0);
}

function getTargetConfigs() {
	return [
		{
			archTag: "darwin-arm64",
			swiftTarget: "arm64-apple-macos14.0",
		},
		{
			archTag: "darwin-x64",
			swiftTarget: "x86_64-apple-macos14.0",
		},
	];
}

const helpers = [
	{
		source: "ScreenCaptureKitRecorder.swift",
		output: "recordly-screencapturekit-helper",
	},
	{
		source: "ScreenCaptureKitWindowList.swift",
		output: "recordly-window-list",
	},
	{
		source: "SystemCursorAssets.swift",
		output: "recordly-system-cursors",
	},
	{
		source: "NativeCursorMonitor.swift",
		output: "recordly-native-cursor-monitor",
	},
];

const swiftcCheck = spawnSync("swiftc", ["--version"], { encoding: "utf8" });
if (swiftcCheck.status !== 0) {
	const details = [swiftcCheck.stderr, swiftcCheck.stdout].filter(Boolean).join("\n").trim();
	throw new Error(details || "swiftc is unavailable; install Xcode Command Line Tools.");
}

for (const target of getTargetConfigs()) {
	const outputDir = path.join(nativeRoot, "bin", target.archTag);
	await mkdir(outputDir, { recursive: true });

	for (const helper of helpers) {
		const sourcePath = path.join(nativeRoot, helper.source);
		const outputPath = path.join(outputDir, helper.output);

		const result = spawnSync(
			"swiftc",
			["-O", "-target", target.swiftTarget, sourcePath, "-o", outputPath],
			{
				encoding: "utf8",
				env: {
					...process.env,
					CLANG_MODULE_CACHE_PATH: path.join(moduleCacheRoot, "clang"),
					SWIFT_MODULECACHE_PATH: path.join(moduleCacheRoot, "swift"),
				},
				timeout: 120000,
			},
		);

		if (result.status !== 0) {
			const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
			throw new Error(details || `Failed to compile ${helper.source} for ${target.archTag}`);
		}

		await chmod(outputPath, 0o755);
		console.log(
			`[build-native-helpers] Built ${helper.output} (${target.archTag}) -> ${outputPath}`,
		);
	}
}
