import { describe, expect, it } from "vitest";
import {
	canUseInMemoryExportSaveFallback,
	describeBlockedInMemoryExportSave,
	isExportTooLargeForInMemorySave,
	MAX_IN_MEMORY_EXPORT_BYTES,
	normalizeExportExtension,
} from "./exportSavePolicy";

describe("exportSavePolicy", () => {
	it("normalizes export extensions before policy checks", () => {
		expect(normalizeExportExtension(" MP4 ")).toBe("mp4");
	});

	it("blocks the legacy in-memory save path above Node's Buffer limit", () => {
		expect(isExportTooLargeForInMemorySave(MAX_IN_MEMORY_EXPORT_BYTES + 1)).toBe(true);
		expect(
			canUseInMemoryExportSaveFallback({
				blobSize: MAX_IN_MEMORY_EXPORT_BYTES + 1,
				extension: "gif",
				hasExportStreamApi: false,
			}),
		).toBe(false);
	});

	it("keeps Electron MP4 exports on the temp-file save path", () => {
		expect(
			canUseInMemoryExportSaveFallback({
				blobSize: 1024,
				extension: "mp4",
				hasExportStreamApi: true,
			}),
		).toBe(false);
	});

	it("allows small non-MP4 exports to use the legacy save fallback", () => {
		expect(
			canUseInMemoryExportSaveFallback({
				blobSize: 1024,
				extension: "gif",
				hasExportStreamApi: false,
			}),
		).toBe(true);
	});

	it("explains blocked large saves without mentioning implementation stack traces", () => {
		expect(
			describeBlockedInMemoryExportSave({
				blobSize: MAX_IN_MEMORY_EXPORT_BYTES + 1,
				extension: "mp4",
			}),
		).toContain("too large");
	});
});
