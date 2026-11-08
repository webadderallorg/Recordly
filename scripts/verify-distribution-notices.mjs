import { readFileSync } from "node:fs";
import path from "node:path";
import { verifyFfmpegDistribution, verifyFfprobeDistribution } from "./ffmpeg-distribution.mjs";
import { assertFfmpegSourceClearance } from "./ffmpeg-source-clearance.mjs";

export function verifyPackagedDistributionNotices(resourcesDir, binaryPath) {
	const directory = path.join(resourcesDir, "licenses");
	const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
	assertFfmpegSourceClearance({ platform: manifest.platform, arch: manifest.arch });
	for (const file of [
		"LICENSE.md",
		"THIRD_PARTY_NOTICES.md",
		"SOURCE_CODE.txt",
		"assets/cursors/community/bee/LICENSE",
		"assets/cursors/community/breezex/LICENSE",
		"assets/cursors/community/catppuccin-pink/LICENSE",
		"assets/cursors/pixel-glove/LICENSE.GPL",
		"assets/cursors/pixel-glove/arrow.svg",
		"assets/fonts/dm-sans/OFL.txt",
		"assets/fonts/tiktok-sans/OFL.txt",
		"native/sherpa-onnx/LICENSE",
		"native/onnxruntime/LICENSE",
		"native/onnxruntime/ThirdPartyNotices.txt",
	]) {
		if (!readFileSync(path.join(directory, file), "utf8").trim()) {
			throw new Error(`Packaged distribution notice is empty: ${file}`);
		}
	}
	for (const pkg of manifest.packages) {
		for (const file of pkg.legalFiles) {
			readFileSync(path.join(directory, pkg.noticeDirectory, file));
		}
	}
	verifyFfmpegDistribution(binaryPath, {
		platform: manifest.platform,
		arch: manifest.arch,
		metadataPath: path.join(directory, "ffmpeg", "ffmpeg"),
		sourcesPath: path.join(directory, "ffmpeg", "sources"),
	});
	if (manifest.platform === "win32") {
		verifyFfprobeDistribution(
			path.join(path.dirname(binaryPath), "../ffprobe-static/bin/win32/x64/ffprobe.exe"),
			{
				platform: manifest.platform,
				arch: manifest.arch,
				metadataPath: path.join(directory, "ffprobe", "ffprobe"),
			},
		);
	}
	return manifest;
}
