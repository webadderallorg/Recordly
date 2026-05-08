import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Windows native helper path resolution", () => {
	let tempRoot: string;
	let appPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-helper-paths-"));
		appPath = path.join(tempRoot, "App");
		await fs.mkdir(appPath, { recursive: true });

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => appPath,
			},
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("prefers the branch-staged helper over a stale local CMake build in dev", async () => {
		const buildOutputPath = path.join(
			appPath,
			"electron",
			"native",
			"wgc-capture",
			"build",
			"Release",
			"wgc-capture.exe",
		);
		const prebundledPath = path.join(
			appPath,
			"electron",
			"native",
			"bin",
			process.arch === "arm64" ? "win32-arm64" : "win32-x64",
			"wgc-capture.exe",
		);
		await fs.mkdir(path.dirname(buildOutputPath), { recursive: true });
		await fs.mkdir(path.dirname(prebundledPath), { recursive: true });
		await fs.writeFile(buildOutputPath, "old-local-build");
		await fs.writeFile(prebundledPath, "branch-staged-helper");

		const { getWindowsCaptureExePath } = await import("./binaries");

		expect(getWindowsCaptureExePath()).toBe(prebundledPath);
	});

	it("falls back to the local CMake build when no staged helper exists", async () => {
		const buildOutputPath = path.join(
			appPath,
			"electron",
			"native",
			"wgc-capture",
			"build",
			"Release",
			"wgc-capture.exe",
		);
		await fs.mkdir(path.dirname(buildOutputPath), { recursive: true });
		await fs.writeFile(buildOutputPath, "local-build");

		const { getWindowsCaptureExePath } = await import("./binaries");

		expect(getWindowsCaptureExePath()).toBe(buildOutputPath);
	});
});
