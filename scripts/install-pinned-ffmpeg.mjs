import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildPinnedFfmpeg, withPinnedFfmpegWorkspace } from "./build-pinned-ffmpeg.mjs";
import { assertFfmpegSourceClearance } from "./ffmpeg-source-clearance.mjs";
import { peContentHash } from "./pe-content-hash.mjs";

const root = process.cwd();
const { platform, arch } = process;
const suffix = platform === "win32" ? ".exe" : "";
const ffmpeg = path.join(root, "node_modules", "ffmpeg-static", `ffmpeg${suffix}`);
const ffprobe =
	platform === "win32"
		? path.join(root, "node_modules/ffprobe-static/bin/win32", arch, "ffprobe.exe")
		: path.join(path.dirname(ffmpeg), "ffprobe-recordly");
const locations = { ffmpeg, ffprobe };
const sources = `${ffmpeg}.sources`;
async function install(work) {
	const { evidence, binaries, provenance } = await buildPinnedFfmpeg({
		root,
		platform,
		arch,
		work,
	});
	const noticeFiles = ["COPYING.GPLv3", "FFmpeg-LICENSE.md", "x264-COPYING", "libvpx-LICENSE"];
	const license = (
		await Promise.all(noticeFiles.map((name) => fs.readFile(path.join(evidence, name), "utf8")))
	).join("\n\n");
	const readme =
		"FFmpeg and FFprobe were built together from pinned source under GPL-3.0-or-later. See ffmpeg/sources/build.json and the accompanying archives for exact build inputs.\n";
	for (const [name, destination] of Object.entries(locations)) {
		await fs.mkdir(path.dirname(destination), { recursive: true });
		const bytes = await fs.readFile(binaries[name]);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const contentSha256 = platform === "win32" ? peContentHash(bytes) : sha256;
		const manifest = { schemaVersion: 1, ...provenance, sha256, contentSha256 };
		await fs.writeFile(`${destination}.LICENSE`, license);
		await fs.writeFile(`${destination}.README`, readme);
		await fs.writeFile(
			`${destination}.distribution.json`,
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		await fs.copyFile(binaries[name], destination);
		await fs.chmod(destination, 0o755);
	}
	await fs.cp(evidence, sources, { recursive: true });
	assertFfmpegSourceClearance({ platform, arch, ffmpeg, ffprobe, sources });
	console.log(
		`[ffmpeg-source] Verified both binaries and their corresponding source at ${sources}`,
	);
}

try {
	await withPinnedFfmpegWorkspace(install);
} catch (error) {
	console.error(`[ffmpeg-source] ${error.message}`);
	process.exitCode = 1;
}
