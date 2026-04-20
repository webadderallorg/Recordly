import { spawnSync } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const nativeRoot = path.join(projectRoot, "electron", "native");

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
		sources: [
			"ScreenCaptureKitRecorder.swift",
			"ScreenCaptureKitRecorder/ScreenCaptureRecorder.swift",
			"ScreenCaptureKitRecorder/ScreenCaptureRecorder+Stream.swift",
			"ScreenCaptureKitRecorder/RecorderService.swift",
		],
		output: "recordly-screencapturekit-helper",
	},
	{
		sources: ["ScreenCaptureKitWindowList.swift"],
		output: "recordly-window-list",
	},
	{
		sources: ["SystemCursorAssets.swift"],
		output: "recordly-system-cursors",
	},
	{
		sources: ["NativeCursorMonitor.swift"],
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
		const sourcePaths = helper.sources.map((source) => path.join(nativeRoot, source));
		const outputPath = path.join(outputDir, helper.output);

		const result = spawnSync(
			"swiftc",
			["-O", "-target", target.swiftTarget, ...sourcePaths, "-o", outputPath],
			{
				encoding: "utf8",
				timeout: 120000,
			},
		);

		if (result.status !== 0) {
			const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
			throw new Error(details || `Failed to compile ${helper.sources[0]} for ${target.archTag}`);
		}

		await chmod(outputPath, 0o755);
		console.log(
			`[build-native-helpers] Built ${helper.output} (${target.archTag}) -> ${outputPath}`,
		);
	}
}
