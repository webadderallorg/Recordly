import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	PINNED_BUILD_FILES,
	PINNED_BUILD_ID,
	PINNED_SOURCE_ARCHIVES,
	supportsPinnedBuild,
} from "./build-pinned-ffmpeg.mjs";
import { verifyFfmpegDistribution, verifyFfprobeDistribution } from "./ffmpeg-distribution.mjs";

export function assertFfmpegSourceClearance({
	platform,
	arch,
	ffmpeg,
	ffprobe,
	metadata,
	probeMetadata,
	sources,
}) {
	if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return;
	if (platform !== "win32" && platform !== "linux") {
		throw new Error(`No reviewed FFmpeg source bundle is configured for ${platform}/${arch}.`);
	}
	try {
		if (!supportsPinnedBuild(platform, arch) || !ffmpeg || !ffprobe || !sources) {
			throw new Error("Pinned Windows or Linux x64 build artifacts are missing.");
		}
		const target = { platform, arch };
		const main = verifyFfmpegDistribution(ffmpeg, { ...target, metadataPath: metadata });
		const probe = verifyFfprobeDistribution(ffprobe, {
			...target,
			metadataPath: probeMetadata,
		});
		if (main.buildId !== PINNED_BUILD_ID || probe.buildId !== PINNED_BUILD_ID) {
			throw new Error("Both executables must come from Recordly's pinned build.");
		}
		const evidence = JSON.parse(readFileSync(path.join(sources, "build.json"), "utf8"));
		if (
			evidence.buildId !== PINNED_BUILD_ID ||
			evidence.platform !== platform ||
			evidence.arch !== arch ||
			evidence.binaryHashes?.ffmpeg !== main.sha256 ||
			evidence.binaryHashes?.ffprobe !== probe.sha256 ||
			main.files?.["build.json"] !== probe.files?.["build.json"]
		) {
			throw new Error("The source bundle does not describe both executables.");
		}
		const digest = (name) =>
			createHash("sha256")
				.update(readFileSync(path.join(sources, name)))
				.digest("hex");
		for (const { name, sha256 } of PINNED_SOURCE_ARCHIVES) {
			if (digest(name) !== sha256) throw new Error(`Source archive changed: ${name}`);
		}
		for (const name of PINNED_BUILD_FILES) {
			if (digest(name) !== main.files?.[name] || main.files[name] !== probe.files?.[name]) {
				throw new Error(`Build evidence changed: ${name}`);
			}
		}
	} catch (error) {
		throw new Error(
			`FFmpeg source clearance is incomplete for ${platform}/${arch}. Run npm run build:ffmpeg-source on the target host. ${error.message}`,
			{ cause: error },
		);
	}
}
