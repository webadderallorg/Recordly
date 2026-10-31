import { describe, expect, it } from "vitest";

import { getMediaContentType, isSupportedLocalMediaPath } from "./mediaTypes";

describe("mediaTypes", () => {
  it("recognizes .m4a as audio/mp4", () => {
    expect(getMediaContentType("recording.m4a")).toBe("audio/mp4");
  });

  it("supports .m4a as a local media path", () => {
    expect(isSupportedLocalMediaPath("recording.m4a")).toBe(true);
  });
});
