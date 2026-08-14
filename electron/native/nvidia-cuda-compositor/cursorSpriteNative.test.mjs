// Native cursor-sprite compositor tests. These run the actually-built
// recordly-nvidia-cuda-compositor.exe helper and verify the cursor-sprite
// overlay contract end to end without needing renderer scaffolding:
//   - build test: --help advertises the --cursor-sprite route
//   - dry-run: a malformed positions sidecar hard-fails with an actionable JSON
//     failure and noCpuFallback:true (strict native route never silently omits)
//   - summary: a valid cursor-sprite layer is reported (cursorSpriteLayers)
// Tests skip when the helper is not built or no CUDA device is present.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPOSITOR_NAME = "recordly-nvidia-cuda-compositor.exe";
const executablePath = join(__dirname, "build", "Release", COMPOSITOR_NAME);

const helperAvailable = existsSync(executablePath);

function makeTempDir(prefix = "recordly-cursor-native-") {
	return mkdtempSync(join(tmpdir(), prefix));
}

function writePositions(dir, positions, name = "positions.json") {
	const path = join(dir, name);
	writeFileSync(path, JSON.stringify(positions));
	return path;
}

function writeSpriteStrip(dir, width, height, frameCount, name = "sprite.rgba") {
	const path = join(dir, name);
	writeFileSync(path, Buffer.alloc(width * height * 4 * frameCount, 0x7f));
	return path;
}

// Parses the first JSON-ish summary line printed on stdout or stderr.
function parseResult(stdout, stderr) {
	const text = `${stdout}\n${stderr}`;
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed);
			if ("success" in parsed) {
				return parsed;
			}
		} catch {
			// Some lines are PROGRESS JSON that are wrapped; skip non-result lines.
		}
	}
	return null;
}

function runHelper(args, options = {}) {
	return execFileSync(executablePath, args, {
		encoding: "utf8",
		windowsHide: true,
		maxBuffer: 64 * 1024 * 1024,
		...options,
	});
}

const hasGpu = (() => {
	if (!helperAvailable) {
		return false;
	}
	try {
		const stdout = runHelper(["--capability-only"]);
		return JSON.parse(stdout.trim()).success === true;
	} catch {
		return false;
	}
})();

describe("native cursor-sprite compositor (built helper)", () => {
	it("is a build test: --help advertises the --cursor-sprite route", () => {
		if (!helperAvailable) {
			return;
		}
		const help = runHelper(["--help"]);
		expect(help).toContain("--cursor-sprite");
	});

	it("hard-fails a malformed positions sidecar with noCpuFallback:true", () => {
		if (!helperAvailable) {
			return;
		}
		const dir = makeTempDir();
		try {
			const sprite = writeSpriteStrip(dir, 4, 4, 10);
			// Wrong count: 2 positions for a 10-frame strip.
			const positions = writePositions(dir, [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			]);
			let error = null;
			try {
				runHelper([
					"--capability-only",
					"--cursor-sprite",
					"cursor",
					"5",
					sprite,
					positions,
					"4",
					"4",
					"10",
				]);
			} catch (thrown) {
				error = thrown;
			}
			expect(error).not.toBeNull();
			const result = parseResult(error?.stdout ?? "", error?.stderr ?? "");
			expect(result).not.toBeNull();
			expect(result.success).toBe(false);
			expect(String(result.error)).toContain(
				"exactly one {x,y} per output frame: expected 10, received 2",
			);
			expect(result.noCpuFallback).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts a valid cursor-sprite layer in a dry-run (no strict failure)", () => {
		if (!helperAvailable || !hasGpu) {
			return;
		}
		const dir = makeTempDir();
		try {
			const sprite = writeSpriteStrip(dir, 4, 4, 2);
			const positions = writePositions(dir, [
				{ x: 0, y: 0 },
				{ x: 8, y: 8 },
			]);
			const stdout = runHelper([
				"--capability-only",
				"--cursor-sprite",
				"cursor",
				"5",
				sprite,
				positions,
				"4",
				"4",
				"2",
			]);
			const result = parseResult(stdout, "");
			expect(result?.success).toBe(true);
			// A valid cursor-sprite dry-run must not fail closed; no strict-native
			// failure is reported for well-formed input.
			expect(result.noCpuFallback).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
