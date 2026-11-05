import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
