import { describe, expect, it, vi } from "vitest";
import {
	describeVideoLoadError,
	formatVideoLoadErrorLog,
	isSourceStillServable,
	toVideoLoadErrorKind,
	VIDEO_LOAD_ERROR_PREFIX,
	type VideoLoadErrorDetail,
} from "./videoLoadError";

const SERVER_URL = "http://127.0.0.1:55640/video?path=%2Frecordings%2Fclip.mp4";

function detail(overrides: Partial<VideoLoadErrorDetail> = {}): VideoLoadErrorDetail {
	return {
		code: 4,
		kind: "src-not-supported",
		message: "",
		src: SERVER_URL,
		sourcePath: "/recordings/clip.mp4",
		servable: true,
		...overrides,
	};
}

describe("toVideoLoadErrorKind", () => {
	it("maps every MediaError code to its own kind", () => {
		expect(toVideoLoadErrorKind(1)).toBe("aborted");
		expect(toVideoLoadErrorKind(2)).toBe("network");
		expect(toVideoLoadErrorKind(3)).toBe("decode");
		expect(toVideoLoadErrorKind(4)).toBe("src-not-supported");
	});

	it("does not pretend to know an absent or unknown code", () => {
		expect(toVideoLoadErrorKind(undefined)).toBe("unknown");
		expect(toVideoLoadErrorKind(99)).toBe("unknown");
	});
});

describe("describeVideoLoadError", () => {
	it("keeps the literal prefix useVideoSourceRecovery retries on", () => {
		expect(VIDEO_LOAD_ERROR_PREFIX).toBe("Failed to load video");
		const cases = [
			detail(),
			detail({ code: 3, kind: "decode", message: "boom" }),
			detail({ code: undefined, kind: "unknown", message: undefined }),
		];
		for (const input of cases) {
			expect(describeVideoLoadError(input).startsWith("Failed to load video")).toBe(true);
		}
	});

	it("never calls code 4 a format problem, because it is fetch or decode", () => {
		const message = describeVideoLoadError(detail({ message: "" }));
		expect(message).toContain("fetched or decoded");
		expect(message).not.toContain("format not supported");
	});

	it("names the media-server refusal when the app stopped serving the file", () => {
		const message = describeVideoLoadError(detail({ servable: false }));
		expect(message).toContain("no longer serving this file");
		expect(message).not.toContain("format");
	});

	it("names the file:// rejection Chromium reports on an http page", () => {
		expect(
			describeVideoLoadError(
				detail({
					message: "MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check",
					src: "file:///recordings/clip.mp4",
				}),
			),
		).toContain("file:// URL");
	});

	it("names a zero-length or truncated file", () => {
		expect(
			describeVideoLoadError(
				detail({
					message:
						"PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed",
				}),
			),
		).toContain("empty or was cut off");
	});

	it("prefers the demuxer's reason over the servable check", () => {
		expect(
			describeVideoLoadError(
				detail({
					message: "PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN: open context failed",
					servable: false,
				}),
			),
		).toContain("empty or was cut off");
	});

	it("keeps the decoder's own words for a real decode failure", () => {
		expect(
			describeVideoLoadError(
				detail({
					code: 3,
					kind: "decode",
					message: "PipelineStatus::DECODER_ERROR_NOT_SUPPORTED",
				}),
			),
		).toContain("DECODER_ERROR_NOT_SUPPORTED");
	});

	it("passes an unrecognised reason through verbatim", () => {
		expect(
			describeVideoLoadError(
				detail({ message: "PipelineStatus::DEMUXER_ERROR_NO_SUPPORTED_STREAMS" }),
			),
		).toContain("DEMUXER_ERROR_NO_SUPPORTED_STREAMS");
	});

	it("admits the player gave no reason rather than inventing one", () => {
		const message = describeVideoLoadError(detail({ servable: null, message: "" }));
		expect(message).toContain("gave no reason");
		expect(message).not.toContain("format not supported");
	});

	it("separates a cancelled load from a failed one", () => {
		expect(describeVideoLoadError(detail({ code: 1, kind: "aborted" }))).toContain("cancelled");
	});

	it("reports a download failure as a download failure", () => {
		expect(describeVideoLoadError(detail({ code: 2, kind: "network" }))).toContain(
			"download failed",
		);
	});
});

describe("formatVideoLoadErrorLog", () => {
	it("carries the code, kind, raw message, src, source path and servable check", () => {
		const line = formatVideoLoadErrorLog(detail({ servable: false }));
		expect(line).toContain("code=4");
		expect(line).toContain("kind=src-not-supported");
		expect(line).toContain('message=""');
		expect(line).toContain(`src=${SERVER_URL}`);
		expect(line).toContain("sourcePath=/recordings/clip.mp4");
		expect(line).toContain("servable=false");
	});

	it("says unknown rather than dropping a missing code", () => {
		expect(formatVideoLoadErrorLog(detail({ code: undefined, kind: "unknown" }))).toContain(
			"code=unknown",
		);
	});
});

describe("isSourceStillServable", () => {
	it("reports a source the app will still serve", async () => {
		await expect(
			isSourceStillServable("/recordings/clip.mp4", {
				getLocalMediaUrl: async () => ({ success: true }),
			}),
		).resolves.toBe(true);
	});

	it("reports a source the app has stopped serving", async () => {
		await expect(
			isSourceStillServable("/recordings/clip.mp4", {
				getLocalMediaUrl: async () => ({ success: false }),
			}),
		).resolves.toBe(false);
	});

	it("checks nothing for an empty path", async () => {
		const getLocalMediaUrl = vi.fn();
		await expect(isSourceStillServable("", { getLocalMediaUrl })).resolves.toBeNull();
		expect(getLocalMediaUrl).not.toHaveBeenCalled();
	});

	it("reports unknown instead of hanging when the main process never answers", async () => {
		await expect(
			isSourceStillServable("/recordings/clip.mp4", {
				getLocalMediaUrl: () => new Promise(() => undefined),
				timeoutMs: 10,
			}),
		).resolves.toBeNull();
	});

	it("reports unknown instead of throwing when the IPC call rejects", async () => {
		await expect(
			isSourceStillServable("/recordings/clip.mp4", {
				getLocalMediaUrl: async () => {
					throw new Error("no handler");
				},
			}),
		).resolves.toBeNull();
	});
});
