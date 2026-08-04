import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readOverlayManifest } from "./overlayManifest.mjs";

// Contract for renderer-prepared transparent RGBA overlay sidecars:
// - frameCount is the logical frame count (durationSec * frameRate).
// - effectiveFrameCount (optional) is the physical frame count when renderer
//   deduplication truncated an identical suffix; the sidecar then stores only
//   effectiveFrameCount frames and the final physical frame repeats for output
//   indices [effectiveFrameCount, frameCount).
// - Byte validation must use the physical count; metadata must keep the logical
//   count; the native --overlay descriptor must receive the physical count so
//   OverlayFrameSource clamps/repeats the final frame.

const OUTPUT_SIZE = { outputWidth: 1920, outputHeight: 1080 };
const FRAME_BYTES = 4 * 4 * 4; // 4x4 RGBA

function makeTempDir(prefix = "recordly-overlay-manifest-") {
	return mkdtempSync(join(tmpdir(), prefix));
}

function writeManifest(dir, layers, name = "overlay-manifest.json") {
	const manifestPath = join(dir, name);
	writeFileSync(manifestPath, JSON.stringify({ layers }));
	return manifestPath;
}

function writeSidecar(dir, byteLength, name = "overlay.rgba") {
	const sidecarPath = join(dir, name);
	writeFileSync(sidecarPath, Buffer.alloc(byteLength, 0x7f));
	return sidecarPath;
}

function layer(overrides = {}) {
	return {
		id: "overlay-a",
		path: "",
		x: 0,
		y: 0,
		width: 4,
		height: 4,
		frameCount: 10,
		...overrides,
	};
}

describe("readOverlayManifest", () => {
	it("returns an empty array when no manifest path is provided", () => {
		expect(readOverlayManifest("", OUTPUT_SIZE)).toEqual([]);
		expect(readOverlayManifest(null, OUTPUT_SIZE)).toEqual([]);
	});

	it("rejects a missing manifest file", () => {
		expect(() => readOverlayManifest("/missing/overlay.json", OUTPUT_SIZE)).toThrow(
			"Overlay manifest does not exist:",
		);
	});

	it("rejects invalid JSON and a missing layers array", () => {
		const dir = makeTempDir();
		try {
			const badJson = join(dir, "bad.json");
			writeFileSync(badJson, "{not json");
			expect(() => readOverlayManifest(badJson, OUTPUT_SIZE)).toThrow(
				/Invalid overlay manifest/,
			);

			const noLayers = join(dir, "no-layers.json");
			writeFileSync(noLayers, JSON.stringify({ frames: 10 }));
			expect(() => readOverlayManifest(noLayers, OUTPUT_SIZE)).toThrow(
				"Overlay manifest requires a layers array:",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts a manifest without effectiveFrameCount and validates bytes against the logical count", () => {
		const dir = makeTempDir();
		try {
			const sidecar = writeSidecar(dir, FRAME_BYTES * 10);
			const manifestPath = writeManifest(dir, [layer({ path: sidecar })]);
			const layers = readOverlayManifest(manifestPath, OUTPUT_SIZE);
			expect(layers).toEqual([
				{
					id: "overlay-a",
					path: sidecar,
					x: 0,
					y: 0,
					width: 4,
					height: 4,
					frameCount: 10,
				},
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts an effectiveFrameCount sidecar with only physical frames and preserves the logical count", () => {
		const dir = makeTempDir();
		try {
			const sidecar = writeSidecar(dir, FRAME_BYTES * 2);
			const manifestPath = writeManifest(dir, [
				layer({ path: sidecar, frameCount: 10, effectiveFrameCount: 2 }),
			]);
			const layers = readOverlayManifest(manifestPath, OUTPUT_SIZE);
			expect(layers).toEqual([
				{
					id: "overlay-a",
					path: sidecar,
					x: 0,
					y: 0,
					width: 4,
					height: 4,
					frameCount: 10,
					effectiveFrameCount: 2,
				},
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts effectiveFrameCount equal to frameCount (no dedup truncation)", () => {
		const dir = makeTempDir();
		try {
			const sidecar = writeSidecar(dir, FRAME_BYTES * 10);
			const manifestPath = writeManifest(dir, [
				layer({ path: sidecar, frameCount: 10, effectiveFrameCount: 10 }),
			]);
			const layers = readOverlayManifest(manifestPath, OUTPUT_SIZE);
			expect(layers[0].frameCount).toBe(10);
			expect(layers[0].effectiveFrameCount).toBe(10);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("treats a null effectiveFrameCount as absent (backward compatible)", () => {
		const dir = makeTempDir();
		try {
			const sidecar = writeSidecar(dir, FRAME_BYTES * 10);
			const manifestPath = writeManifest(dir, [
				layer({ path: sidecar, effectiveFrameCount: null }),
			]);
			const layers = readOverlayManifest(manifestPath, OUTPUT_SIZE);
			expect(layers[0]).not.toHaveProperty("effectiveFrameCount");
			expect(layers[0].frameCount).toBe(10);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects effectiveFrameCount values outside 1..frameCount with the invalid-layer message", () => {
		const dir = makeTempDir();
		try {
			const sidecar = writeSidecar(dir, FRAME_BYTES * 10);
			for (const effectiveFrameCount of [0, -1, 11, 1.5, "not-a-number"]) {
				const manifestPath = writeManifest(
					dir,
					[layer({ path: sidecar, frameCount: 10, effectiveFrameCount })],
					`invalid-${String(effectiveFrameCount)}.json`,
				);
				expect(() => readOverlayManifest(manifestPath, OUTPUT_SIZE)).toThrow(
					"Invalid overlay manifest layer overlay-a:",
				);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("validates physical bytes against effectiveFrameCount, not the logical count", () => {
		const dir = makeTempDir();
		try {
			// Logical count implies 10 frames (10 * FRAME_BYTES) but the sidecar
			// physically stores 2; with the physical-count rule this is valid.
			const sidecar = writeSidecar(dir, FRAME_BYTES * 2);
			const manifestPath = writeManifest(dir, [
				layer({ path: sidecar, frameCount: 10, effectiveFrameCount: 2 }),
			]);
			expect(readOverlayManifest(manifestPath, OUTPUT_SIZE)).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails a sidecar truncated below the physical count (with effectiveFrameCount)", () => {
		const dir = makeTempDir();
		try {
			const sidecar = writeSidecar(dir, FRAME_BYTES * 2 - 1);
			const manifestPath = writeManifest(dir, [
				layer({ path: sidecar, frameCount: 10, effectiveFrameCount: 2 }),
			]);
			expect(() => readOverlayManifest(manifestPath, OUTPUT_SIZE)).toThrow(
				`Overlay layer overlay-a is truncated: expected at least ${
					FRAME_BYTES * 2
				} bytes, received ${FRAME_BYTES * 2 - 1}`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps the backward-compatible truncation message for manifests without effectiveFrameCount", () => {
		const dir = makeTempDir();
		try {
			const sidecar = writeSidecar(dir, FRAME_BYTES * 9);
			const manifestPath = writeManifest(dir, [layer({ path: sidecar })]);
			expect(() => readOverlayManifest(manifestPath, OUTPUT_SIZE)).toThrow(
				`Overlay layer overlay-a is truncated: expected at least ${
					FRAME_BYTES * 10
				} bytes, received ${FRAME_BYTES * 9}`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("enforces output-canvas bounds for every layer", () => {
		const dir = makeTempDir();
		try {
			const sidecar = writeSidecar(dir, FRAME_BYTES * 10);
			const manifestPath = writeManifest(dir, [layer({ path: sidecar, x: 1918, width: 4 })]);
			expect(() => readOverlayManifest(manifestPath, OUTPUT_SIZE)).toThrow(
				"Overlay layer overlay-a exceeds the output canvas:",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects layers missing an id/path or with invalid geometry", () => {
		const dir = makeTempDir();
		try {
			const sidecar = writeSidecar(dir, FRAME_BYTES * 10);
			const missingId = writeManifest(dir, [layer({ path: sidecar, id: "" })]);
			expect(() => readOverlayManifest(missingId, OUTPUT_SIZE)).toThrow(
				"Overlay manifest layer requires an id and path:",
			);

			const missingPath = writeManifest(dir, [layer({ path: "" })]);
			expect(() => readOverlayManifest(missingPath, OUTPUT_SIZE)).toThrow(
				"Overlay manifest layer requires an id and path:",
			);

			const badGeometry = writeManifest(dir, [layer({ path: sidecar, width: 0 })]);
			expect(() => readOverlayManifest(badGeometry, OUTPUT_SIZE)).toThrow(
				"Invalid overlay manifest layer overlay-a:",
			);

			const negativeX = writeManifest(dir, [layer({ path: sidecar, x: -1 })]);
			expect(() => readOverlayManifest(negativeX, OUTPUT_SIZE)).toThrow(
				"Invalid overlay manifest layer overlay-a:",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects a missing sidecar file", () => {
		const dir = makeTempDir();
		try {
			const manifestPath = writeManifest(dir, [layer({ path: join(dir, "nope.rgba") })]);
			expect(() => readOverlayManifest(manifestPath, OUTPUT_SIZE)).toThrow(
				"Overlay layer overlay-a does not exist:",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("handles mixed layers (deduped and fully dynamic) in one manifest", () => {
		const dir = makeTempDir();
		try {
			const fullSidecar = writeSidecar(dir, FRAME_BYTES * 10, "full.rgba");
			const dedupedSidecar = writeSidecar(dir, FRAME_BYTES * 3, "deduped.rgba");
			const manifestPath = writeManifest(dir, [
				layer({ id: "a", path: fullSidecar, frameCount: 10 }),
				layer({ id: "b", path: dedupedSidecar, frameCount: 10, effectiveFrameCount: 3 }),
			]);
			const layers = readOverlayManifest(manifestPath, OUTPUT_SIZE);
			expect(layers).toHaveLength(2);
			expect(layers[0]).toMatchObject({ id: "a", frameCount: 10 });
			expect(layers[0]).not.toHaveProperty("effectiveFrameCount");
			expect(layers[1]).toMatchObject({ id: "b", frameCount: 10, effectiveFrameCount: 3 });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
