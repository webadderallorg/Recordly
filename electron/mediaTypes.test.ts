import { describe, expect, it } from "vitest";
import { getMediaContentType, isSupportedLocalMediaPath } from "./mediaTypes";

describe("mediaTypes", () => {
	it("allows macOS mic and system audio sidecars (.m4a)", () => {
		expect(isSupportedLocalMediaPath("/tmp/recording-1.mic.m4a")).toBe(true);
		expect(isSupportedLocalMediaPath("/tmp/recording-1.system.m4a")).toBe(true);
		expect(getMediaContentType("/tmp/recording-1.mic.m4a")).toBe("audio/mp4");
	});

	it("still rejects unsupported extensions", () => {
		expect(isSupportedLocalMediaPath("/tmp/notes.txt")).toBe(false);
		expect(getMediaContentType("/tmp/notes.txt")).toBe("application/octet-stream");
	});
});
