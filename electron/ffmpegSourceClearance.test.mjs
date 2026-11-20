import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PINNED_BUILD_ID, withPinnedFfmpegWorkspace } from "../scripts/build-pinned-ffmpeg.mjs";
import { assertFfmpegSourceClearance } from "../scripts/ffmpeg-source-clearance.mjs";
import { updateNativeHelperManifest } from "../scripts/native-helper-manifest.mjs";
import beforePack from "../scripts/prepare-distribution-notices.mjs";
import { verifyPackagedDistributionNotices } from "../scripts/verify-distribution-notices.mjs";

const temporary = [];
async function directory() {
	const value = await mkdtemp(path.join(os.tmpdir(), "recordly-source-clearance-"));
	temporary.push(value);
	return value;
}

async function contents(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	return Object.fromEntries(
		await Promise.all(
			entries.map(async (entry) => {
				const file = path.join(directory, entry.name);
				return [
					entry.name,
					entry.isDirectory() ? await contents(file) : await readFile(file, "base64"),
				];
			}),
		),
	);
}

async function captureFixture(projectRoot) {
	const sourceDir = path.join(projectRoot, "electron/native/wgc-capture");
	const binaryPath = path.join(projectRoot, "electron/native/bin/win32-x64/wgc-capture.exe");
	await mkdir(sourceDir, { recursive: true });
	await mkdir(path.dirname(binaryPath), { recursive: true });
	await writeFile(path.join(sourceDir, "main.cpp"), "capture source fixture");
	await writeFile(binaryPath, "capture binary fixture");
	updateNativeHelperManifest({
		projectRoot,
		helperId: "wgc-capture",
		sourceDir,
		binaryPath,
		binaryName: "wgc-capture.exe",
		platform: "win32",
		arch: "x64",
	});
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		temporary.splice(0).map((value) => rm(value, { recursive: true, force: true })),
	);
});

describe("FFmpeg packaging source clearance", () => {
	it.each([
		["win32", "x64"],
		["linux", "x64"],
		["linux", "arm64"],
	])("rejects %s/%s despite its separately approved binary provenance", (platform, arch) => {
		expect(() => assertFfmpegSourceClearance({ platform, arch })).toThrow(
			`source clearance is incomplete for ${platform}/${arch}`,
		);
	});

	it.each([
		"arm64",
		"x64",
	])("keeps the existing pinned-source Mac %s verifier path available", (arch) => {
		expect(() => assertFfmpegSourceClearance({ platform: "darwin", arch })).not.toThrow();
	});

	it("does not treat an unknown platform as source-cleared", () => {
		expect(() => assertFfmpegSourceClearance({ platform: "freebsd", arch: "x64" })).toThrow(
			"No reviewed FFmpeg source bundle",
		);
	});

	it.each([
		"win32",
		"linux",
	])("blocks %s before packaging downloads or writes artifacts", async (platform) => {
		const root = await directory();
		// Satisfy the independent capture gate so this case reaches FFmpeg clearance.
		if (platform === "win32") await captureFixture(root);
		const before = await contents(root);
		const fetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Unexpected download"));
		await expect(
			beforePack({
				packager: { projectDir: root },
				arch: "x64",
				electronPlatformName: platform,
			}),
		).rejects.toThrow(`source clearance is incomplete for ${platform}/x64`);
		expect(fetch).not.toHaveBeenCalled();
		expect(await contents(root)).toEqual(before);
	});

	it("rejects source metadata that matches FFmpeg but describes a different FFprobe build", async () => {
		const root = await directory();
		const sources = path.join(root, "sources");
		await mkdir(sources);
		const ffmpeg = path.join(root, "ffmpeg");
		const ffprobe = path.join(root, "ffprobe");
		const target = { platform: "linux", arch: "x64" };
		const hashes = {};
		for (const binary of [ffmpeg, ffprobe]) {
			const name = path.basename(binary);
			const body = "#!/bin/sh\nprintf 'GNU General Public License\\n'\n# " + name + "\n";
			const sha256 = createHash("sha256").update(body).digest("hex");
			hashes[name] = sha256;
			await writeFile(binary, body);
			await chmod(binary, 0o755);
			await writeFile(binary + ".LICENSE", "license fixture");
			await writeFile(binary + ".README", "source fixture");
			await writeFile(
				binary + ".distribution.json",
				JSON.stringify({
					schemaVersion: 1,
					...target,
					buildId: PINNED_BUILD_ID,
					sha256,
				}),
			);
		}
		await writeFile(
			path.join(sources, "build.json"),
			JSON.stringify({
				...target,
				buildId: PINNED_BUILD_ID,
				binaryHashes: { ffmpeg: hashes.ffmpeg, ffprobe: hashes.ffmpeg },
			}),
		);
		expect(() => assertFfmpegSourceClearance({ ...target, ffmpeg, ffprobe, sources })).toThrow(
			"The source bundle does not describe both executables.",
		);
	});

	it("rejects a pre-existing non-Mac package before notice contents can imply clearance", async () => {
		const resources = await directory();
		await mkdir(path.join(resources, "licenses"));
		await writeFile(
			path.join(resources, "licenses", "manifest.json"),
			JSON.stringify({ platform: "win32", arch: "x64" }),
		);
		expect(() => verifyPackagedDistributionNotices(resources, "/missing/ffmpeg.exe")).toThrow(
			"source clearance is incomplete for win32/x64",
		);
	});
});

describe("pinned FFmpeg build workspace", () => {
	it.each([
		false,
		true,
	])("removes build files when the installer callback fails=%s", async (fail) => {
		let owned;
		const build = withPinnedFfmpegWorkspace(async (work) => {
			owned = work;
			await writeFile(path.join(work, "object-file"), "fixture");
			if (fail) throw new Error("installation failed");
			return "installed";
		});
		if (fail) await expect(build).rejects.toThrow("installation failed");
		else await expect(build).resolves.toBe("installed");
		await expect(readdir(owned)).rejects.toMatchObject({ code: "ENOENT" });
	});
});
