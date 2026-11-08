import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
	buildMacFfmpeg,
	MAC_BUILD_ID,
	MAC_SOURCE_ARCHIVES,
} from "./build-redistributable-ffmpeg.mjs";
import { machoContentHash } from "./macho-content-hash.mjs";
import { peContentHash } from "./pe-content-hash.mjs";

const upstreamRelease = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";
// Verified raw release digests. The upstream darwin-arm64 artifact enables nonfree.
export const APPROVED_FFMPEG_BINARIES = Object.freeze({
	"win32-x64": "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00",
	"linux-x64": "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
	"linux-arm64": "6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce",
});
const windowsFfprobeSha256 = "3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4";
const windowsFfmpegContentSha256 =
	"e7d76a7bfd32b60f20c7e9f2fba1c3059d2edc629ccb730310d7a000be0a2b37";
const windowsFfprobeContentSha256 =
	"f2e535164943b58f6dad618f75c8ad00eb2c6c232caad899d77a28ce37d54edb";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contentHash = (bytes, platform) =>
	platform === "darwin"
		? machoContentHash(bytes)
		: platform === "win32"
			? peContentHash(bytes)
			: sha256(bytes);

function matchesBinary(bytes, manifest, platform, expectedSignedContent) {
	if (manifest.sha256 === sha256(bytes)) return true;
	if (platform !== "darwin" && platform !== "win32") return false;
	if (!manifest.contentSha256) return false;
	if (expectedSignedContent && manifest.contentSha256 !== expectedSignedContent) return false;
	return manifest.contentSha256 === contentHash(bytes, platform);
}

export function assertRedistributableFfmpegOutput(output) {
	if (
		/--enable-nonfree(?:[\s\0]|$)/i.test(output) ||
		/not legally redistributable|unredistributable/i.test(output)
	) {
		throw new Error("FFmpeg contains nonfree parts and cannot be packaged for redistribution.");
	}
	if (!/GNU (?:General|Lesser General) Public License/i.test(output)) {
		throw new Error("FFmpeg did not report a recognized GPL/LGPL license.");
	}
}

export function verifyFfmpegDistribution(
	binaryPath,
	{
		platform = process.platform,
		arch = process.arch,
		metadataPath = binaryPath,
		sourcesPath = `${metadataPath}.sources`,
	} = {},
) {
	const bytes = readFileSync(binaryPath);
	const manifest = JSON.parse(readFileSync(`${metadataPath}.distribution.json`, "utf8"));
	if (
		manifest.schemaVersion !== 1 ||
		manifest.platform !== platform ||
		manifest.arch !== arch ||
		!matchesBinary(
			bytes,
			manifest,
			platform,
			platform === "win32" ? windowsFfmpegContentSha256 : undefined,
		)
	) {
		throw new Error("FFmpeg distribution provenance does not match the binary or target.");
	}
	if (platform === "darwin") {
		if (
			manifest.buildId !== MAC_BUILD_ID ||
			!MAC_SOURCE_ARCHIVES.every((source) =>
				manifest.sources?.some(
					(entry) => entry.name === source.name && entry.sha256 === source.sha256,
				),
			)
		) {
			throw new Error(
				"macOS FFmpeg was not built from Recordly's pinned redistributable sources.",
			);
		}
		for (const source of MAC_SOURCE_ARCHIVES) {
			if (sha256(readFileSync(path.join(sourcesPath, source.name))) !== source.sha256) {
				throw new Error(
					`FFmpeg corresponding source is missing or changed: ${source.name}`,
				);
			}
		}
	} else if (APPROVED_FFMPEG_BINARIES[`${platform}-${arch}`] !== manifest.sha256) {
		throw new Error(`Unapproved FFmpeg distribution for ${platform}/${arch}.`);
	}
	for (const suffix of [".LICENSE", ".README"]) {
		if (!readFileSync(`${metadataPath}${suffix}`, "utf8").trim())
			throw new Error(`FFmpeg distribution is missing ${suffix}.`);
	}
	if (platform === process.platform && arch === process.arch) {
		const license = execFileSync(binaryPath, ["-L"], {
			encoding: "utf8",
			timeout: 15000,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		assertRedistributableFfmpegOutput(license);
	}
	return manifest;
}

export function verifyFfprobeDistribution(
	binaryPath,
	{ platform = process.platform, arch = process.arch, metadataPath = binaryPath } = {},
) {
	const manifest = JSON.parse(readFileSync(`${metadataPath}.distribution.json`, "utf8"));
	if (
		platform !== "win32" ||
		arch !== "x64" ||
		manifest.schemaVersion !== 1 ||
		manifest.platform !== platform ||
		manifest.arch !== arch ||
		manifest.sha256 !== windowsFfprobeSha256 ||
		!matchesBinary(readFileSync(binaryPath), manifest, platform, windowsFfprobeContentSha256)
	) {
		throw new Error(
			"FFprobe distribution provenance does not match the approved Windows binary.",
		);
	}
	for (const suffix of [".LICENSE", ".README"]) {
		if (!readFileSync(`${metadataPath}${suffix}`, "utf8").trim())
			throw new Error(`FFprobe distribution is missing ${suffix}.`);
	}
	if (platform === process.platform && arch === process.arch) {
		assertRedistributableFfmpegOutput(
			execFileSync(binaryPath, ["-L"], {
				encoding: "utf8",
				timeout: 15000,
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			}),
		);
	}
	return manifest;
}

async function download(url) {
	const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
	if (!response.ok) throw new Error(`FFmpeg download failed (${response.status}): ${url}`);
	return Buffer.from(await response.arrayBuffer());
}

async function ensureWindowsFfprobe(root) {
	const binaryPath = path.join(root, "node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe");
	try {
		const manifest = {
			...verifyFfprobeDistribution(binaryPath, { platform: "win32", arch: "x64" }),
			contentSha256: windowsFfprobeContentSha256,
		};
		await writeFile(
			`${binaryPath}.distribution.json`,
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		return manifest;
	} catch {
		/* Replace legacy/missing binaries. */
	}
	const url = `${upstreamRelease}/ffprobe-win32-x64.gz`;
	const bytes = gunzipSync(await download(url), { maxOutputLength: 200 * 1024 * 1024 });
	if (sha256(bytes) !== windowsFfprobeSha256)
		throw new Error("Downloaded FFprobe failed its pinned SHA-256 check.");
	await mkdir(path.dirname(binaryPath), { recursive: true });
	await writeFile(`${binaryPath}.download`, bytes, { mode: 0o755 });
	await rename(`${binaryPath}.download`, binaryPath);
	await copyFile(
		path.join(root, "src/assets/cursors/pixel-glove/LICENSE.GPL"),
		`${binaryPath}.LICENSE`,
	);
	const readme = (await download(`${upstreamRelease}/win32-x64.README`)).toString("utf8");
	await writeFile(
		`${binaryPath}.README`,
		`FFprobe, GPL-3.0-or-later. Artifact: ${url}\nUpstream build/source information:\n${readme}`,
	);
	await writeFile(
		`${binaryPath}.distribution.json`,
		`${JSON.stringify({ schemaVersion: 1, platform: "win32", arch: "x64", sha256: windowsFfprobeSha256, contentSha256: windowsFfprobeContentSha256, artifactUrl: url }, null, 2)}\n`,
	);
	return verifyFfprobeDistribution(binaryPath, { platform: "win32", arch: "x64" });
}

export async function ensureRedistributableFfmpeg({
	root = process.cwd(),
	platform = process.env.npm_config_platform || process.platform,
	arch = process.env.npm_config_arch || process.arch,
} = {}) {
	const binaryPath = path.join(
		root,
		"node_modules",
		"ffmpeg-static",
		platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
	);
	let existingManifest;
	try {
		existingManifest = verifyFfmpegDistribution(binaryPath, { platform, arch });
	} catch {
		// Missing, stale, nonfree or changed artifact: install a verified replacement.
	}
	if (existingManifest) {
		const manifest = {
			...existingManifest,
			contentSha256: contentHash(readFileSync(binaryPath), platform),
		};
		await writeFile(
			`${binaryPath}.distribution.json`,
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		console.log(
			`[ffmpeg] Verified redistributable ${platform}/${arch} binary (${manifest.sha256.slice(0, 12)}).`,
		);
		if (platform === "win32" && arch === "x64") await ensureWindowsFfprobe(root);
		return manifest;
	}
	await mkdir(path.dirname(binaryPath), { recursive: true });
	if (existsSync(binaryPath)) {
		const backup = path.join(
			root,
			".tmp",
			"ffmpeg-distribution",
			"previous",
			`${platform}-${arch}-${sha256(readFileSync(binaryPath))}`,
		);
		await mkdir(path.dirname(backup), { recursive: true });
		if (!existsSync(backup)) await copyFile(binaryPath, backup);
	}
	let provenance;
	if (platform === "darwin") {
		provenance = await buildMacFfmpeg({ root, arch, destination: binaryPath });
	} else {
		const expected = APPROVED_FFMPEG_BINARIES[`${platform}-${arch}`];
		if (!expected)
			throw new Error(
				`No redistributable FFmpeg artifact configured for ${platform}/${arch}.`,
			);
		const url = `${upstreamRelease}/ffmpeg-${platform}-${arch}.gz`;
		const bytes = gunzipSync(await download(url), { maxOutputLength: 200 * 1024 * 1024 });
		if (sha256(bytes) !== expected)
			throw new Error("Downloaded FFmpeg failed its pinned SHA-256 check.");
		const temporaryPath = `${binaryPath}.download`;
		await writeFile(temporaryPath, bytes, { mode: 0o755 });
		await rename(temporaryPath, binaryPath);
		await chmod(binaryPath, 0o755);
		await copyFile(
			path.join(root, "src", "assets", "cursors", "pixel-glove", "LICENSE.GPL"),
			`${binaryPath}.LICENSE`,
		);
		const upstreamReadme = (
			await download(`${upstreamRelease}/${platform}-${arch}.README`)
		).toString("utf8");
		await writeFile(
			`${binaryPath}.README`,
			`Recordly bundles this separate FFmpeg executable under GPL-3.0-or-later.\nArtifact: ${url}\nSHA-256: ${expected}\nBuild/source information supplied by the artifact provider follows.\n\n${upstreamReadme}`,
		);
		provenance = {
			buildId: "ffmpeg-static-b6.1.1",
			artifactUrl: url,
			sourceInstructions: upstreamReadme,
		};
	}
	const manifest = {
		schemaVersion: 1,
		platform,
		arch,
		...provenance,
		sha256: sha256(readFileSync(binaryPath)),
		contentSha256: contentHash(readFileSync(binaryPath), platform),
	};
	await writeFile(`${binaryPath}.distribution.json`, `${JSON.stringify(manifest, null, 2)}\n`);
	verifyFfmpegDistribution(binaryPath, { platform, arch });
	if (platform === "win32" && arch === "x64") await ensureWindowsFfprobe(root);
	return manifest;
}
