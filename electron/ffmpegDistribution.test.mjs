import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	APPROVED_FFMPEG_BINARIES,
	assertRedistributableFfmpegOutput,
	verifyFfmpegDistribution,
} from "../scripts/ffmpeg-distribution.mjs";

const fixtures = [];
function fixture(overrides = {}) {
	const directory = mkdtempSync(path.join(os.tmpdir(), "recordly-ffmpeg-provenance-"));
	fixtures.push(directory);
	const binary = path.join(directory, "ffmpeg");
	const bytes = Buffer.from("unapproved executable fixture");
	writeFileSync(binary, bytes);
	writeFileSync(
		`${binary}.distribution.json`,
		JSON.stringify({
			schemaVersion: 1,
			platform: "win32",
			arch: "x64",
			sha256: createHash("sha256").update(bytes).digest("hex"),
			...overrides,
		}),
	);
	return binary;
}
afterEach(() => {
	for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("FFmpeg redistribution checks", () => {
	it("does not accept a content-hash override for an unapproved Linux executable", () => {
		const binary = fixture({
			platform: "linux",
			sha256: APPROVED_FFMPEG_BINARIES["linux-x64"],
			contentSha256: createHash("sha256")
				.update("unapproved executable fixture")
				.digest("hex"),
		});
		expect(() => verifyFfmpegDistribution(binary, { platform: "linux", arch: "x64" })).toThrow(
			"does not match",
		);
	});
	it("accepts GPL/LGPL builds with nonfree explicitly disabled", () => {
		expect(() =>
			assertRedistributableFfmpegOutput(
				"--disable-nonfree\nGNU General Public License version 3",
			),
		).not.toThrow();
		expect(() =>
			assertRedistributableFfmpegOutput("GNU Lesser General Public License version 2.1"),
		).not.toThrow();
	});
	it("rejects the real nonredistributable build declaration despite GPL text", () => {
		expect(() =>
			assertRedistributableFfmpegOutput(
				"GNU General Public License\nThis version of ffmpeg has nonfree parts compiled in. Therefore it is not legally redistributable.",
			),
		).toThrow("nonfree");
		expect(() =>
			assertRedistributableFfmpegOutput(
				"configuration: --enable-gpl --enable-nonfree\nGNU General Public License",
			),
		).toThrow("nonfree");
	});
	it("rejects missing or unrecognized license output", () => {
		expect(() => assertRedistributableFfmpegOutput("ffmpeg version 8.1.2")).toThrow(
			"recognized",
		);
	});
	it("rejects a changed executable even with an existing provenance record", () => {
		const binary = fixture();
		writeFileSync(binary, "changed after verification");
		expect(() => verifyFfmpegDistribution(binary, { platform: "win32", arch: "x64" })).toThrow(
			"does not match",
		);
	});
	it("rejects an artifact from another target architecture", () => {
		expect(() =>
			verifyFfmpegDistribution(fixture(), { platform: "win32", arch: "arm64" }),
		).toThrow("does not match");
	});
	it("does not trust an arbitrary binary merely because its manifest has a matching checksum", () => {
		expect(() =>
			verifyFfmpegDistribution(fixture(), { platform: "win32", arch: "x64" }),
		).toThrow("Unapproved");
	});
	it("rejects a manifest pretending to be a macOS source build", () => {
		expect(() =>
			verifyFfmpegDistribution(
				fixture({ platform: "darwin", arch: "arm64", buildId: "made-up" }),
				{ platform: "darwin", arch: "arm64" },
			),
		).toThrow("pinned redistributable sources");
	});
});
