import { describe, expect, it } from "vitest";

import {
	createProjectData,
	normalizeProjectEditor,
	validateProjectData,
} from "./projectPersistence";
import { ADVANCED_VERTICAL_PADDING_MAX } from "./types";

describe("normalizeProjectEditor", () => {
	it("preserves the extended advanced vertical padding range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: 240,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 22,
				right: 22,
				linked: false,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 240,
			bottom: ADVANCED_VERTICAL_PADDING_MAX,
			left: 22,
			right: 22,
			linked: false,
		});
	});

	it("keeps linked padding clamped to the original range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: ADVANCED_VERTICAL_PADDING_MAX,
				right: ADVANCED_VERTICAL_PADDING_MAX,
				linked: true,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 100,
			bottom: 100,
			left: 100,
			right: 100,
			linked: true,
		});
	});

	it("defaults new H.265/bitrate fields to h264/auto/auto/20", () => {
		const editor = normalizeProjectEditor({});

		expect(editor.exportVideoCodec).toBe("h264");
		expect(editor.exportEncoderPreference).toBe("auto");
		expect(editor.exportBitrateMode).toBe("auto");
		expect(editor.exportBitrateMbps).toBe(20);
	});

	it("normalizes invalid H.265/bitrate persisted values safely", () => {
		const editor = normalizeProjectEditor({
			exportVideoCodec: "vp9",
			exportEncoderPreference: "turbo",
			exportBitrateMode: "ultra",
			exportBitrateMbps: 5000,
		});

		expect(editor.exportVideoCodec).toBe("h264");
		expect(editor.exportEncoderPreference).toBe("auto");
		expect(editor.exportBitrateMode).toBe("auto");
		expect(editor.exportBitrateMbps).toBe(105);

		const hevcClamp = normalizeProjectEditor({
			exportVideoCodec: "hevc",
			exportBitrateMbps: 5000,
		});
		expect(hevcClamp.exportVideoCodec).toBe("hevc");
		expect(hevcClamp.exportBitrateMbps).toBe(70);

		const lowClamp = normalizeProjectEditor({ exportBitrateMbps: -3 });
		expect(lowClamp.exportBitrateMbps).toBe(1);

		const nanFallback = normalizeProjectEditor({ exportBitrateMbps: Number.NaN });
		expect(nanFallback.exportBitrateMbps).toBe(20);
	});

	it("preserves valid H.265/bitrate values through a project round trip", () => {
		const editor = normalizeProjectEditor({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			exportBitrateMode: "custom",
			exportBitrateMbps: 48,
		});

		const data = createProjectData("/tmp/video.mp4", editor);
		expect(validateProjectData(data)).toBe(true);

		const reloaded = normalizeProjectEditor(data.editor);
		expect(reloaded.exportVideoCodec).toBe("hevc");
		expect(reloaded.exportEncoderPreference).toBe("hardware");
		expect(reloaded.exportBitrateMode).toBe("custom");
		expect(reloaded.exportBitrateMbps).toBe(48);
	});
});
