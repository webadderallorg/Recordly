import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
		setPath: vi.fn(),
		isReady: vi.fn(() => true),
	},
}));

import { repairBundledUiohookBinaryForCurrentArch } from "./interaction";

describe("repairBundledUiohookBinaryForCurrentArch", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.splice(0).map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })),
		);
	});

	it("promotes the bundled darwin-arm64 prebuild over a stale incompatible build", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-uiohook-"));
		tempRoots.push(tempRoot);

		const packageRoot = path.join(tempRoot, "uiohook-napi");
		const prebuildPath = path.join(packageRoot, "prebuilds", "darwin-arm64", "node.napi.node");
		const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");
		await fs.mkdir(path.dirname(prebuildPath), { recursive: true });
		await fs.mkdir(path.dirname(buildPath), { recursive: true });
		await fs.writeFile(prebuildPath, "arm64-prebuild");
		await fs.writeFile(buildPath, "x64-build");

		const log = vi.fn();
		const repaired = repairBundledUiohookBinaryForCurrentArch(
			Object.assign(new Error("mach-o file, but is an incompatible architecture (have 'x86_64', need 'arm64')"), {
				code: "ERR_DLOPEN_FAILED",
			}),
			{ packageRoot, platform: "darwin", arch: "arm64", log },
		);

		expect(repaired).toBe(true);
		expect(await fs.readFile(buildPath, "utf8")).toBe("arm64-prebuild");
		expect(log).toHaveBeenCalledWith(
			"[CursorTelemetry] Repaired stale uiohook-napi binary using bundled darwin-arm64 prebuild.",
		);
	});

	it("does not rewrite binaries for unrelated load failures", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-uiohook-"));
		tempRoots.push(tempRoot);

		const packageRoot = path.join(tempRoot, "uiohook-napi");
		const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");
		await fs.mkdir(path.dirname(buildPath), { recursive: true });
		await fs.writeFile(buildPath, "existing-build");

		const repaired = repairBundledUiohookBinaryForCurrentArch(
			Object.assign(new Error("some other dlopen failure"), {
				code: "ERR_DLOPEN_FAILED",
			}),
			{ packageRoot, platform: "darwin", arch: "arm64" },
		);

		expect(repaired).toBe(false);
		expect(await fs.readFile(buildPath, "utf8")).toBe("existing-build");
	});
});