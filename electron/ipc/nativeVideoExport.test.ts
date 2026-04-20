import { describe, expect, it } from "vitest";
import {
	isNativeVideoExportPassthroughAudioCodec,
	shouldCopyNativeVideoExportAudio,
} from "./nativeVideoExport";

describe("isNativeVideoExportPassthroughAudioCodec", () => {
	it("accepts AAC codec strings that MP4 can stream-copy", () => {
		expect(isNativeVideoExportPassthroughAudioCodec("aac")).toBe(true);
		expect(isNativeVideoExportPassthroughAudioCodec("mp4a.40.2")).toBe(true);
		expect(isNativeVideoExportPassthroughAudioCodec("audio/mp4; codecs=mp4a.40.2")).toBe(true);
	});

	it("rejects codecs that still require transcoding", () => {
		expect(isNativeVideoExportPassthroughAudioCodec("opus")).toBe(false);
		expect(isNativeVideoExportPassthroughAudioCodec("vorbis")).toBe(false);
		expect(isNativeVideoExportPassthroughAudioCodec(null)).toBe(false);
	});
});

describe("shouldCopyNativeVideoExportAudio", () => {
	it("copies copy-source audio when the source codec is AAC-compatible", () => {
		expect(
			shouldCopyNativeVideoExportAudio({
				audioMode: "copy-source",
				audioCodec: "mp4a.40.2",
			}),
		).toBe(true);
	});

	it("keeps trim-source on the transcode path", () => {
		expect(
			shouldCopyNativeVideoExportAudio({
				audioMode: "trim-source",
				audioCodec: "mp4a.40.2",
			}),
		).toBe(false);
	});

	it("allows future edited-track AAC payloads to skip re-encode", () => {
		expect(
			shouldCopyNativeVideoExportAudio({
				audioMode: "edited-track",
				editedAudioMimeType: "audio/mp4; codecs=mp4a.40.2",
			}),
		).toBe(true);
	});
});
