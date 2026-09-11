import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectMissingMarkers, defaultAsarPath, parseVerifyArgs } from "./verify-smoke-build.mjs";

const tempDirs = [];
afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function writeFixture(name, bytes) {
	const dir = mkdtempSync(join(tmpdir(), "verify-smoke-build-"));
	tempDirs.push(dir);
	const filePath = join(dir, name);
	writeFileSync(filePath, bytes, "latin1");
	return filePath;
}

describe("collectMissingMarkers", () => {
	it("returns an empty list when every marker is present", () => {
		const haystack =
			'console.log("[FrameRenderer] Deferred sprite texture retirement active");RECORDLY_LINUX_RENDER_BACKEND';
		expect(
			collectMissingMarkers(haystack, [
				"Deferred sprite texture retirement",
				"RECORDLY_LINUX_RENDER_BACKEND",
			]),
		).toEqual([]);
	});

	it("reports only the missing markers", () => {
		const haystack = "RECORDLY_LINUX_RENDER_BACKEND=webgl";
		expect(
			collectMissingMarkers(haystack, [
				"RECORDLY_LINUX_RENDER_BACKEND",
				"Deferred sprite texture retirement",
				"[VideoExporter] Using",
			]),
		).toEqual(["Deferred sprite texture retirement", "[VideoExporter] Using"]);
	});

	it("keeps binary-safe latin1 bytes searchable (marker adjacent to non-utf8 bytes)", () => {
		const haystack = `\xFF\xFE\x00prefix \xFF[smoke-export] Export failed\xFF`;
		expect(collectMissingMarkers(haystack, ["[smoke-export] Export failed"])).toEqual([]);
	});

	it("returns every marker for an empty payload", () => {
		expect(collectMissingMarkers("", ["a", "b"])).toEqual(["a", "b"]);
	});
});

describe("parseVerifyArgs", () => {
	it("parses repeated --expect flags and a custom --asar path", () => {
		const parsed = parseVerifyArgs([
			"--asar",
			"/tmp/custom.asar",
			"--expect",
			"marker one",
			"--expect",
			"marker two",
		]);
		expect(parsed.asarPath).toBe("/tmp/custom.asar");
		expect(parsed.markers).toEqual(["marker one", "marker two"]);
	});

	it("defaults the asar path to the linux unpacked build", () => {
		const parsed = parseVerifyArgs(["--expect", "marker"]);
		expect(parsed.asarPath).toBe(defaultAsarPath);
		expect(parsed.markers).toEqual(["marker"]);
	});

	it("fails fast when no marker is requested", () => {
		expect(() => parseVerifyArgs([])).toThrow(/--expect/);
	});
});

describe("writeFixture helper (latin1 round-trip)", () => {
	it("round-trips non-utf8 bytes so markers stay searchable", () => {
		const filePath = writeFixture("fixture.asar", `\xFFmarker-bytes\xFF`);
		expect(readFileSync(filePath, "latin1")).toContain("marker-bytes");
	});
});
