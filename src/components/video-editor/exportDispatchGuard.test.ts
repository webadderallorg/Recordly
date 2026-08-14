import { describe, expect, it } from "vitest";

import { createExportSlotGuard, resolveRestoredExportCodecEncoder } from "./exportDispatchGuard";

describe("createExportSlotGuard", () => {
	it("blocks a second dispatch while one export is preparing/running", () => {
		const guard = createExportSlotGuard();
		expect(guard.tryAcquire()).toBe(true);
		// A concurrent dispatch must be rejected — this prevents a second export
		// from overwriting exporterRef and shadowing the intended codec/encoder.
		expect(guard.tryAcquire()).toBe(false);
		expect(guard.tryAcquire()).toBe(false);
	});

	it("re-arms after release so a post-failure retry is not blocked", () => {
		const guard = createExportSlotGuard();
		expect(guard.tryAcquire()).toBe(true);
		// Export settles (success or failure): finally releases the slot.
		guard.release();
		expect(guard.tryAcquire()).toBe(true);
	});

	it("release is idempotent and does not deadlock the guard", () => {
		const guard = createExportSlotGuard();
		guard.release();
		guard.release();
		expect(guard.tryAcquire()).toBe(true);
	});
});

describe("resolveRestoredExportCodecEncoder", () => {
	it("preserves an explicit HEVC Hardware project selection", () => {
		expect(
			resolveRestoredExportCodecEncoder(
				{ exportVideoCodec: "hevc", exportEncoderPreference: "hardware" },
				"h264",
				"auto",
			),
		).toEqual({ exportVideoCodec: "hevc", exportEncoderPreference: "hardware" });
	});

	it("does not silently downgrade an explicit HEVC selection when only one field is persisted", () => {
		// Project window only persisted the codec; encoder preference must be kept
		// from the current editor state rather than reset to h264/auto.
		expect(
			resolveRestoredExportCodecEncoder({ exportVideoCodec: "hevc" }, "h264", "hardware"),
		).toEqual({ exportVideoCodec: "hevc", exportEncoderPreference: "hardware" });
		expect(
			resolveRestoredExportCodecEncoder(
				{ exportEncoderPreference: "hardware" },
				"hevc",
				"auto",
			),
		).toEqual({ exportVideoCodec: "hevc", exportEncoderPreference: "hardware" });
	});

	it("preserves the current editor selection when the project did not persist codec/encoder", () => {
		// Older/new project file without explicit export fields: keep the live
		// selection instead of falling back to the h264/auto default.
		expect(resolveRestoredExportCodecEncoder({}, "hevc", "hardware")).toEqual({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
		});
		expect(resolveRestoredExportCodecEncoder(undefined, "hevc", "hardware")).toEqual({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
		});
	});

	it("keeps current values for a brand-new project (existing default h264/auto), never an invalid value", () => {
		expect(resolveRestoredExportCodecEncoder(undefined, "h264", "auto")).toEqual({
			exportVideoCodec: "h264",
			exportEncoderPreference: "auto",
		});
		// Garbage/invalid persisted values are ignored and the current selection wins.
		expect(
			resolveRestoredExportCodecEncoder(
				{ exportVideoCodec: "vp9", exportEncoderPreference: "turbo" },
				"hevc",
				"hardware",
			),
		).toEqual({ exportVideoCodec: "hevc", exportEncoderPreference: "hardware" });
	});
});
