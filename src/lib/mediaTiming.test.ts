import { describe, expect, it } from "vitest";

import {
  clampMediaTimeToDuration,
  getEffectiveRecordingDurationMs,
} from "./mediaTiming";

describe("clampMediaTimeToDuration", () => {
  it("clamps playback time to known media duration", () => {
    expect(clampMediaTimeToDuration(12, 4.5)).toBe(4.5);
    expect(clampMediaTimeToDuration(-1, 4.5)).toBe(0);
  });

  it("leaves playback time unchanged when duration is unknown", () => {
    expect(clampMediaTimeToDuration(12, null)).toBe(12);
    expect(clampMediaTimeToDuration(12, Number.NaN)).toBe(12);
  });
});

describe("getEffectiveRecordingDurationMs", () => {
  it("subtracts accumulated paused time", () => {
    expect(
      getEffectiveRecordingDurationMs({
        startTimeMs: 1_000,
        endTimeMs: 11_000,
        accumulatedPausedDurationMs: 2_500,
      }),
    ).toBe(7_500);
  });

  it("subtracts an active pause interval", () => {
    expect(
      getEffectiveRecordingDurationMs({
        startTimeMs: 1_000,
        endTimeMs: 11_000,
        accumulatedPausedDurationMs: 2_000,
        pauseStartedAtMs: 9_000,
      }),
    ).toBe(6_000);
  });
});