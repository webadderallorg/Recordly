import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertNativeHelperManifest,
	updateNativeHelperManifest,
} from "../scripts/native-helper-manifest.mjs";
import beforePack from "../scripts/prepare-distribution-notices.mjs";

const directories = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function fixture(arch = "x64") {
	const projectRoot = mkdtempSync(path.join(os.tmpdir(), "recordly-wgc-provenance-"));
	directories.push(projectRoot);
	const sourceDir = path.join(projectRoot, "electron/native/wgc-capture");
	const binaryPath = path.join(projectRoot, `electron/native/bin/win32-${arch}/wgc-capture.exe`);
	mkdirSync(sourceDir, { recursive: true });
	mkdirSync(path.dirname(binaryPath), { recursive: true });
	const sourcePath = path.join(sourceDir, "main.cpp");
	writeFileSync(sourcePath, "original capture source");
	writeFileSync(binaryPath, "matching executable fixture");
	const options = {
		projectRoot,
		helperId: "wgc-capture",
		sourceDir,
		binaryPath,
		binaryName: "wgc-capture.exe",
		platform: "win32",
		arch,
	};
	updateNativeHelperManifest(options);
	return { options, sourcePath };
}

describe("Windows capture provenance gate", () => {
	it("allows a cached capture helper only when both source and binary match", () => {
		const { options } = fixture();
		expect(assertNativeHelperManifest(options).ok).toBe(true);
	});
	it("requires a rebuild after capture source changes", () => {
		const { options, sourcePath } = fixture();
		writeFileSync(sourcePath, "new audio placement and frame padding");
		expect(() => assertNativeHelperManifest(options)).toThrow("source fingerprint mismatch");
	});
	it("rejects a changed binary with unchanged source", () => {
		const { options } = fixture();
		writeFileSync(options.binaryPath, "unverified executable");
		expect(() => assertNativeHelperManifest(options)).toThrow("binary hash mismatch");
	});
	it.each([
		"x64",
		"arm64",
	])("blocks direct or cross-target %s packaging before modifying distribution output", async (arch) => {
		const { options, sourcePath } = fixture(arch);
		writeFileSync(sourcePath, "source changed after cached Windows build");
		await expect(
			beforePack({
				packager: { projectDir: options.projectRoot },
				arch: arch === "x64" ? 1 : 3,
				electronPlatformName: "win32",
			}),
		).rejects.toThrow("Rebuild the helper from current source on Windows before packaging");
	});
});
