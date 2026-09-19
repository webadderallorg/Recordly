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

import {
	activeKeystrokeSamples,
	setActiveKeystrokeSamples,
	setCursorCaptureStartTimeMs,
	setIsKeystrokeCaptureActive,
} from "../state";
import {
	repairBundledUiohookBinaryForCurrentArch,
	resolveUiohookKeyToken,
	shouldStartGlobalInteractionHook,
} from "./interaction";
import { recordKeystroke, resetKeystrokeRepeatState } from "./keystrokeTelemetry";
import { resetCursorCaptureClock } from "./telemetry";

describe("shouldStartGlobalInteractionHook", () => {
	it("does not start the synchronous uiohook event tap on macOS", () => {
		expect(shouldStartGlobalInteractionHook("darwin")).toBe(false);
	});

	it("keeps global interaction capture enabled on Windows and Linux", () => {
		expect(shouldStartGlobalInteractionHook("win32")).toBe(true);
		expect(shouldStartGlobalInteractionHook("linux")).toBe(true);
	});
});

describe("resolveUiohookKeyToken", () => {
	const keyTable = {
		Enter: 28,
		Escape: 1,
		ArrowLeft: 57419,
		ArrowRight: 57421,
		Left: 100,
		PageUp: 3657,
		A: 30,
		C: 46,
		Comma: 51,
		Ctrl: 29,
		CtrlRight: 3613,
		Alt: 56,
		AltRight: 3640,
		ShiftRight: 54,
		Meta: 3675,
		MetaRight: 3676,
	};

	it("aliases uiohook names onto the overlay token vocabulary", () => {
		expect(resolveUiohookKeyToken(28, keyTable)).toBe("enter");
		expect(resolveUiohookKeyToken(1, keyTable)).toBe("esc");
		expect(resolveUiohookKeyToken(57419, keyTable)).toBe("arrowleft");
		expect(resolveUiohookKeyToken(100, keyTable)).toBe("arrowleft");
		expect(resolveUiohookKeyToken(3657, keyTable)).toBe("pageup");
		expect(resolveUiohookKeyToken(30, keyTable)).toBe("a");
		expect(resolveUiohookKeyToken(46, keyTable)).toBe("c");
		expect(resolveUiohookKeyToken(51, keyTable)).toBe("comma");
		expect(resolveUiohookKeyToken(99999, keyTable)).toBeNull();
	});

	it("folds right-hand modifiers onto the same tokens as the left-hand keys", () => {
		expect(resolveUiohookKeyToken(29, keyTable)).toBe("ctrl");
		expect(resolveUiohookKeyToken(3613, keyTable)).toBe("ctrl");
		expect(resolveUiohookKeyToken(56, keyTable)).toBe("alt");
		expect(resolveUiohookKeyToken(3640, keyTable)).toBe("alt");
		expect(resolveUiohookKeyToken(54, keyTable)).toBe("shift");
		expect(resolveUiohookKeyToken(3675, keyTable)).toBe("meta");
		expect(resolveUiohookKeyToken(3676, keyTable)).toBe("meta");
		expect(resolveUiohookKeyToken(57421, keyTable)).toBe("arrowright");
	});
});

describe("keystroke repeat collapse", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		setIsKeystrokeCaptureActive(false);
		setActiveKeystrokeSamples([]);
		resetKeystrokeRepeatState();
		resetCursorCaptureClock();
	});

	it("bumps last-seen time and emits once for a held key", () => {
		setIsKeystrokeCaptureActive(true);
		setCursorCaptureStartTimeMs(1_000);
		setActiveKeystrokeSamples([]);
		resetKeystrokeRepeatState();
		resetCursorCaptureClock();

		const now = vi.spyOn(Date, "now");
		now.mockReturnValue(1_100);
		recordKeystroke("c", ["meta"]);
		now.mockReturnValue(1_120);
		recordKeystroke("c", ["meta"]);

		expect(activeKeystrokeSamples).toHaveLength(1);
		expect(activeKeystrokeSamples[0]).toMatchObject({ key: "c", modifiers: ["meta"] });

		now.mockReturnValue(1_200);
		recordKeystroke("c", ["meta"]);
		expect(activeKeystrokeSamples).toHaveLength(2);
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
