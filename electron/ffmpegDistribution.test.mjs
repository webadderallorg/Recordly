import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	APPROVED_FFMPEG_BINARIES,
	assertRedistributableFfmpegOutput,
	ensureRedistributableFfmpeg,
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
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
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

const directRelease = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";
const invalidArtifact = gzipSync(Buffer.from("unapproved executable fixture"));
function installTarget(platform = "linux", arch = "x64") {
	const root = mkdtempSync(path.join(os.tmpdir(), "recordly-ffmpeg-download-"));
	fixtures.push(root);
	return ensureRedistributableFfmpeg({ root, platform, arch });
}
function artifactResponse() {
	return new Response(invalidArtifact);
}

describe("FFmpeg release transport", () => {
	it("keeps a successful direct download and still rejects unapproved bytes", async () => {
		const network = vi.fn().mockResolvedValue(artifactResponse());
		vi.stubGlobal("fetch", network);
		await expect(installTarget()).rejects.toThrow("pinned SHA-256 check");
		expect(network).toHaveBeenCalledOnce();
		expect(network.mock.calls[0][0]).toBe(`${directRelease}/ffmpeg-linux-x64.gz`);
		expect(network.mock.calls[0][1]).toEqual({
			signal: expect.any(AbortSignal),
			credentials: "omit",
		});
	});

	it.each([
		500, 502, 503, 504,
	])("falls back once for retryable HTTP %i without accepting changed bytes", async (status) => {
		const failed = new Response("temporarily unavailable", { status });
		const cancel = vi.spyOn(failed.body, "cancel");
		const network = vi
			.fn()
			.mockResolvedValueOnce(failed)
			.mockResolvedValueOnce(artifactResponse());
		vi.stubGlobal("fetch", network);
		await expect(installTarget()).rejects.toThrow("pinned SHA-256 check");
		expect(cancel).toHaveBeenCalledOnce();
		expect(network).toHaveBeenCalledTimes(2);
		expect(network.mock.calls[1]).toEqual([
			"https://api.github.com/repos/eugeneware/ffmpeg-static/releases/assets/316528626",
			{
				signal: expect.any(AbortSignal),
				credentials: "omit",
				headers: { Accept: "application/octet-stream" },
			},
		]);
	});

	it.each([
		["linux", "arm64", 316528458],
		["win32", "x64", 316528798],
	])("uses the same pinned release asset for %s/%s", async (platform, arch, assetId) => {
		const network = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 504 }))
			.mockResolvedValueOnce(artifactResponse());
		vi.stubGlobal("fetch", network);
		await expect(installTarget(platform, arch)).rejects.toThrow("pinned SHA-256 check");
		expect(network.mock.calls.map(([url]) => url)).toEqual([
			`${directRelease}/ffmpeg-${platform}-${arch}.gz`,
			`https://api.github.com/repos/eugeneware/ffmpeg-static/releases/assets/${assetId}`,
		]);
	});

	it.each([
		400, 401, 403, 404, 429,
	])("fails closed without fallback for permanent HTTP %i", async (status) => {
		const network = vi.fn().mockResolvedValue(new Response(null, { status }));
		vi.stubGlobal("fetch", network);
		await expect(installTarget()).rejects.toThrow(`download failed (${status})`);
		expect(network).toHaveBeenCalledOnce();
	});

	it("recovers a network exception through the exact same-provider asset API", async () => {
		const network = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("fetch failed"))
			.mockResolvedValueOnce(artifactResponse());
		vi.stubGlobal("fetch", network);
		await expect(installTarget()).rejects.toThrow("pinned SHA-256 check");
		expect(network).toHaveBeenCalledTimes(2);
		expect(network.mock.calls[1][0]).toBe(
			"https://api.github.com/repos/eugeneware/ffmpeg-static/releases/assets/316528626",
		);
	});

	it("does not retry programming failures as network outages", async () => {
		const network = vi.fn().mockRejectedValue(new Error("unexpected failure"));
		vi.stubGlobal("fetch", network);
		await expect(installTarget()).rejects.toThrow("unexpected failure");
		expect(network).toHaveBeenCalledOnce();
	});

	it("stops after a failed API fallback rather than looping", async () => {
		const network = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 504 }))
			.mockResolvedValueOnce(new Response(null, { status: 503 }));
		vi.stubGlobal("fetch", network);
		await expect(installTarget()).rejects.toThrow("download failed (503)");
		expect(network).toHaveBeenCalledTimes(2);
	});

	it("bounds both stalled requests with real abort signals", async () => {
		const realTimeout = AbortSignal.timeout.bind(AbortSignal);
		const deadlines = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(1));
		const network = vi.fn(
			(_url, { signal }) =>
				new Promise((_resolve, reject) => {
					if (signal.aborted) reject(signal.reason);
					else
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
				}),
		);
		vi.stubGlobal("fetch", network);
		await expect(installTarget()).rejects.toMatchObject({ name: "TimeoutError" });
		expect(network).toHaveBeenCalledTimes(2);
		expect(deadlines.mock.calls).toEqual([[180000], [180000]]);
		expect(network.mock.calls[0][1].signal).not.toBe(network.mock.calls[1][1].signal);
	});

	it("includes response-body stalls in the same two-request bound", async () => {
		const realTimeout = AbortSignal.timeout.bind(AbortSignal);
		const deadlines = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(1));
		const network = vi.fn(async (_url, { signal }) => ({
			ok: true,
			arrayBuffer: () =>
				new Promise((_resolve, reject) => {
					if (signal.aborted) reject(signal.reason);
					else
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
				}),
		}));
		vi.stubGlobal("fetch", network);
		await expect(installTarget()).rejects.toMatchObject({ name: "TimeoutError" });
		expect(network).toHaveBeenCalledTimes(2);
		expect(deadlines.mock.calls).toEqual([[180000], [180000]]);
	});
});
