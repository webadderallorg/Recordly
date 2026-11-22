import { readFileSync } from "node:fs";
import path from "node:path";
import { verifyFfmpegDistribution } from "./ffmpeg-distribution.mjs";
import { assertFfmpegSourceClearance } from "./ffmpeg-source-clearance.mjs";

export function verifyPackagedDistributionNotices(resourcesDir, binaryPath) {
	const directory = path.join(resourcesDir, "licenses");
	const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
	const { platform, arch } = manifest;
	const metadata = path.join(directory, "ffmpeg", "ffmpeg");
	const sources = path.join(directory, "ffmpeg", "sources");
	const ffprobe =
		platform === "win32"
			? path.join(
					path.dirname(binaryPath),
					"../ffprobe-static/bin/win32",
					arch,
					"ffprobe.exe",
				)
			: path.join(path.dirname(binaryPath), "ffprobe-recordly");
	assertFfmpegSourceClearance({
		platform,
		arch,
		ffmpeg: binaryPath,
		ffprobe,
		metadata,
		probeMetadata: path.join(directory, "ffprobe", "ffprobe"),
		sources,
	});
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
	if (platform === "darwin")
		verifyFfmpegDistribution(binaryPath, {
			platform,
			arch,
			metadataPath: metadata,
			sourcesPath: sources,
		});
	return manifest;
}
