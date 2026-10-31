import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

it("probes and caches the runtime's accepted rates", async () => {
	const createElement = vi.fn(() => ({
		set playbackRate(rate: number) {
			if (rate > 16) throw new DOMException("Unsupported rate", "NotSupportedError");
		},
	}));
	vi.stubGlobal("document", { createElement });
	const { supportsPreviewPlaybackRate } = await import("./playbackRate");
	for (const speed of [0.25, 1, 3, 15, 16]) expect(supportsPreviewPlaybackRate(speed)).toBe(true);
	for (const speed of [20, 30]) expect(supportsPreviewPlaybackRate(speed)).toBe(false);
	expect(supportsPreviewPlaybackRate(20)).toBe(false);
	expect(createElement).toHaveBeenCalledTimes(7);
	for (const speed of [0, -1, NaN, Infinity])
		expect(supportsPreviewPlaybackRate(speed)).toBe(false);
});

it.each([
	{ lower: 0.25, upper: 16 },
	{ lower: 0.5, upper: 4 },
	{ lower: 1, upper: 30 },
])("exposes only supported steps between $lower and $upper", async ({ lower, upper }) => {
	vi.stubGlobal("document", { createElement: () => ({
		set playbackRate(rate: number) {
			if (rate < lower || rate > upper) throw new DOMException("Unsupported", "NotSupportedError");
		},
	}) });
	const { getPreviewPlaybackRateRange } = await import("./playbackRate");
	expect(getPreviewPlaybackRateRange()).toEqual({ min: lower, max: upper });
});
