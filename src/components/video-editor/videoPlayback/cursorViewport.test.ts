import { describe, expect, it } from "vitest";

import { projectCursorPositionToViewport } from "./cursorViewport";

describe("projectCursorPositionToViewport", () => {
  it("leaves coordinates unchanged when no crop is active", () => {
    expect(
      projectCursorPositionToViewport({ cx: 0.25, cy: 0.75 }),
    ).toEqual({
      cx: 0.25,
      cy: 0.75,
      visible: true,
    });
  });

  it("remaps source-space coordinates into crop-relative viewport space", () => {
    const projected = projectCursorPositionToViewport(
      { cx: 0.3, cy: 0.55 },
      { x: 0.2, y: 0.4, width: 0.5, height: 0.4 },
    );

    expect(projected.visible).toBe(true);
    expect(projected.cx).toBeCloseTo(0.2, 6);
    expect(projected.cy).toBeCloseTo(0.375, 6);
  });

  it("marks cursor invisible when it falls outside the cropped source region", () => {
    expect(
      projectCursorPositionToViewport(
        { cx: 0.1, cy: 0.5 },
        { x: 0.2, y: 0.25, width: 0.5, height: 0.5 },
      ),
    ).toEqual({
      cx: -0.2,
      cy: 0.5,
      visible: false,
    });
  });
});