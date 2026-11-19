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

vi.mock("../../windows", () => ({
	getHudOverlayInteractiveBounds: vi.fn(),
	getHudOverlayWindow: vi.fn(() => ({
		isVisible: () => true,
		isMinimized: () => false,
	})),
}));

vi.mock("../utils", () => ({
	getScreen: vi.fn(),
}));

vi.mock("./telemetry", () => ({
	getCursorCaptureElapsedMs: () => 42,
	getNormalizedCursorPoint: () => ({ cx: 0.2, cy: 0.3 }),
	isCursorCapturePaused: () => false,
	pushCursorSample: vi.fn(),
}));

import { getHudOverlayInteractiveBounds } from "../../windows";
import { setIsCursorCaptureActive, setLastLeftClick } from "../state";
import { getScreen } from "../utils";
import {
	recordCursorMouseDown,
	repairBundledUiohookBinaryForCurrentArch,
	shouldStartGlobalInteractionHook,
} from "./interaction";
import { pushCursorSample } from "./telemetry";

describe("recordCursorMouseDown with recording overlays", () => {
	afterEach(() => {
		setIsCursorCaptureActive(false);
		setLastLeftClick(null);
		vi.clearAllMocks();
	});

	it("skips clicks on the HUD and webcam preview and records clicks outside both", () => {
		setIsCursorCaptureActive(true);
		setLastLeftClick(null);
		vi.mocked(getHudOverlayInteractiveBounds).mockReturnValue([
			{ left: 100, top: 100, right: 400, bottom: 150 },
			{ left: 450, top: 200, right: 550, bottom: 300 },
		]);
		const getCursorScreenPoint = vi
			.fn()
			.mockReturnValueOnce({ x: 200, y: 125 })
			.mockReturnValueOnce({ x: 500, y: 250 })
			.mockReturnValueOnce({ x: 425, y: 180 });
		vi.mocked(getScreen).mockReturnValue({ getCursorScreenPoint } as ReturnType<
			typeof getScreen
		>);

		recordCursorMouseDown(1);
		recordCursorMouseDown(1);
		expect(pushCursorSample).not.toHaveBeenCalled();

		recordCursorMouseDown(1);
		expect(pushCursorSample).toHaveBeenCalledExactlyOnceWith(
			0.2,
			0.3,
			42,
			"click",
			undefined,
			1,
		);
	});
});

describe("shouldStartGlobalInteractionHook", () => {
	it("does not start the synchronous uiohook event tap on macOS", () => {
		expect(shouldStartGlobalInteractionHook("darwin")).toBe(false);
	});

	it("keeps global interaction capture enabled on Windows and Linux", () => {
		expect(shouldStartGlobalInteractionHook("win32")).toBe(true);
		expect(shouldStartGlobalInteractionHook("linux")).toBe(true);
	});
});

describe("repairBundledUiohookBinaryForCurrentArch", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots
				.splice(0)
				.map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })),
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
			Object.assign(
				new Error(
					"mach-o file, but is an incompatible architecture (have 'x86_64', need 'arm64')",
				),
				{
					code: "ERR_DLOPEN_FAILED",
				},
			),
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
