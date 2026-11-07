import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	calculateMp4ExportDimensions,
	calculateMp4SourceDimensions,
	shouldDebounceMp4SupportProbe,
	isValidCustomExportResolution,
	fitCustomExportResolution,
} from "./exportDimensions";

describe("calculateMp4SourceDimensions", () => {
	it("keeps native exports at the source dimensions", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "native")).toEqual({
			width: 1920,
			height: 1080,
		});
	});

	it("uses the cropped source bounds for native exports", () => {
		expect(
			calculateMp4SourceDimensions(320, 180, "native", {
				width: 1,
				height: 0.8,
			}),
		).toEqual({
			width: 320,
			height: 144,
		});
	});

	it("uses the rotated source bounds for 9:16 original exports", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "9:16")).toEqual({
			width: 1080,
			height: 1920,
		});
	});

	it("ignores crop bounds for fixed-aspect exports", () => {
		expect(
			calculateMp4SourceDimensions(1920, 1080, "9:16", {
				width: 0.5,
				height: 0.5,
			}),
		).toEqual({
			width: 1080,
			height: 1920,
		});
	});

	it("uses the rotated source bounds for portrait social ratios", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "4:5")).toEqual({
			width: 1080,
			height: 1350,
		});
	});

	it("keeps landscape aspect-ratio exports inside the source bounds", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "4:3")).toEqual({
			width: 1440,
			height: 1080,
		});
	});
});

describe("calculateMp4ExportDimensions", () => {
	it("keeps a custom longest edge when the canvas changes to portrait or square", () => {
		expect(
			fitCustomExportResolution({ width: 2400, height: 1350 }, { width: 720, height: 1280 }),
		).toEqual({ width: 1350, height: 2400 });
		expect(
			fitCustomExportResolution({ width: 2400, height: 1350 }, { width: 1000, height: 1000 }),
		).toEqual({ width: 2400, height: 2400 });
	});
	it("exports HD at 720p", () => {
		expect(calculateMp4ExportDimensions(3840, 2160, "hd")).toEqual({
			width: 1280,
			height: 720,
		});
	});

	it("uses custom dimensions exactly and rejects invalid sizes before probing", () => {
		expect(
			calculateMp4ExportDimensions(1920, 1080, "custom", { width: 2400, height: 1350 }),
		).toEqual({ width: 2400, height: 1350 });
		for (const dimensions of [
			{ width: 2401, height: 1350 },
			{ width: 0, height: 1080 },
			{ width: 8194, height: 4608 },
			{ width: NaN, height: 1080 },
		]) {
			expect(isValidCustomExportResolution(dimensions)).toBe(false);
			expect(() => calculateMp4ExportDimensions(1920, 1080, "custom", dimensions)).toThrow(
				"even dimensions",
			);
		}
	});
	it("normalizes odd source dimensions to even export dimensions", () => {
		const sourceDimensions = calculateMp4SourceDimensions(1919, 1079, "native");

		expect(sourceDimensions).toEqual({
			width: 1918,
			height: 1078,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "source"),
		).toEqual({
			width: 1918,
			height: 1078,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "high"),
		).toEqual({
			width: 3840,
			height: 2158,
		});
	});

	it("scales portrait output dimensions from the aspect target", () => {
		const sourceDimensions = calculateMp4SourceDimensions(1920, 1080, "9:16");

		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "source"),
		).toEqual({
			width: 1080,
			height: 1920,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "high"),
		).toEqual({
			width: 2160,
			height: 3840,
		});
	});

	it.each([
		["medium", 1920, 1080],
		["good", 2560, 1440],
		["high", 3840, 2160],
	] as const)("exports %s at its fixed landscape resolution", (preset, width, height) => {
		expect(calculateMp4ExportDimensions(5120, 2880, preset)).toEqual({ width, height });
	});

	it.each([
		["medium", 1920],
		["good", 2560],
		["high", 3840],
	] as const)("preserves square and portrait shapes for %s", (preset, edge) => {
		expect(calculateMp4ExportDimensions(1200, 1200, preset)).toEqual({
			width: edge,
			height: edge,
		});
		const portrait = calculateMp4ExportDimensions(1080, 1920, preset);
		expect(portrait).toEqual({ width: (edge * 9) / 16, height: edge });
	});

	it("scales ultrawide and custom ratios proportionally without cropping", () => {
		expect(calculateMp4ExportDimensions(2400, 1000, "high")).toEqual({
			width: 3840,
			height: 1600,
		});
		expect(calculateMp4ExportDimensions(3000, 2000, "good")).toEqual({
			width: 2560,
			height: 1706,
		});
	});

	it("upscales fixed presets while Original retains a small recording's dimensions", () => {
		expect(calculateMp4ExportDimensions(1280, 720, "high")).toEqual({
			width: 3840,
			height: 2160,
		});
		expect(calculateMp4ExportDimensions(1280, 720, "source")).toEqual({
			width: 1280,
			height: 720,
		});
	});
});

describe("shouldDebounceMp4SupportProbe", () => {
	const baseSnapshot = {
		sourceWidth: 1920,
		sourceHeight: 1080,
		targetWidth: 1920,
		targetHeight: 1080,
		aspectRatio: "native" as const,
		frameRate: 30 as const,
	};

	it("debounces only native crop-driven target changes", () => {
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				targetHeight: 864,
			}),
		).toBe(true);
	});

	it("keeps non-crop probe changes immediate", () => {
		expect(shouldDebounceMp4SupportProbe(null, baseSnapshot)).toBe(false);
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				frameRate: 60,
			}),
		).toBe(false);
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				sourceWidth: 1280,
				sourceHeight: 720,
				targetWidth: 1280,
				targetHeight: 720,
			}),
		).toBe(false);
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				aspectRatio: "16:9",
			}),
		).toBe(false);
	});
});

it("preserves 1440p and 4K originals for local and shared MP4 exports", () => {
	for (const [width, height] of [
		[2560, 1440],
		[3840, 2160],
		[2160, 3840],
		[5120, 2880],
	]) {
		const source = calculateMp4SourceDimensions(width, height, "native");
		expect(calculateMp4ExportDimensions(source.width, source.height, "source")).toEqual({
			width,
			height,
		});
	}
});

// Match React's hook identity/effect cleanup behavior without allocating codecs or a browser.
const hooks = vi.hoisted(() => {
	const slots: unknown[] = [];
	let cursor = 0;
	let effects: (() => void)[] = [];
	let writes = 0;
	const same = (a: readonly unknown[], b: readonly unknown[]) =>
		a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
	function memo<T>(factory: () => T, deps: readonly unknown[]): T {
		const index = cursor++;
		const previous = slots[index] as { deps: readonly unknown[]; value: T } | undefined;
		if (previous && same(previous.deps, deps)) return previous.value;
		const value = factory();
		slots[index] = { deps, value };
		return value;
	}
	return {
		reset() {
			slots.length = 0;
			cursor = 0;
			effects = [];
			writes = 0;
		},
		render<T>(factory: () => T): T {
			cursor = 0;
			effects = [];
			const result = factory();
			for (const effect of effects) effect();
			return result;
		},
		dispose() {
			for (const slot of slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.();
		},
		writes: () => writes,
		useMemo: memo,
		useCallback: <T>(callback: T, deps: readonly unknown[]) => memo(() => callback, deps),
		useRef<T>(current: T) {
			const index = cursor++;
			slots[index] ??= { current };
			return slots[index] as { current: T };
		},
		useState<T>(initial: T) {
			const index = cursor++;
			let state = slots[index] as { value: T; set: (next: T) => void } | undefined;
			if (!state) {
				const created = {
					value: initial,
					set: (next: T) => {
						created.value = next;
						writes++;
					},
				};
				slots[index] = created;
				state = created;
			}
			return [state.value, state.set] as const;
		},
		useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
			const index = cursor++;
			const previous = slots[index] as
				| { deps: readonly unknown[]; cleanup?: () => void }
				| undefined;
			if (previous && same(previous.deps, deps)) return;
			effects.push(() => {
				previous?.cleanup?.();
				slots[index] = { deps, cleanup: effect() };
			});
		},
	};
});
const probes = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("react", () => hooks);
vi.mock("@/i18n/runtime", () => ({ translate: (_key: string, fallback: string) => fallback }));
vi.mock("@/lib/exporter", () => ({
	DEFAULT_MP4_CODEC: "avc1.640034",
	GIF_SIZE_PRESETS: {},
	calculateOutputDimensions: (width: number, height: number) => ({ width, height }),
	probeSupportedMp4Dimensions: probes.probe,
}));
import { useExportDimensions } from "./export/useExportDimensions";
const encoderPath = { codec: "avc1.640034", hardwareAcceleration: "prefer-hardware" };
function sourceInput() {
	return {
		customExportResolution: { width: 1600, height: 900 },
		onCustomExportResolutionChange: vi.fn(),
		videoPlaybackRef: { current: { video: { videoWidth: 1920, videoHeight: 1080 } } },
		isPreviewReady: true,
		aspectRatio: "native",
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		mp4FrameRate: 30,
		gifSizePreset: "original",
	} as unknown as Parameters<typeof useExportDimensions>[0];
}
const flushProbe = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
beforeEach(() => {
	hooks.reset();
	probes.probe.mockReset();
	probes.probe.mockImplementation(
		async ({ width, height }: { width: number; height: number }) => ({
			width,
			height,
			capped: false,
			encoderPath,
		}),
	);
	vi.stubGlobal("window", { setTimeout, clearTimeout, electronAPI: {} });
});
afterEach(() => {
	hooks.dispose();
	vi.unstubAllGlobals();
});
describe("source support probe lifecycle", () => {
	it("does not restart source probing for custom edits while explicit validation uses the latest size", async () => {
		const input = sourceInput();
		hooks.render(() => useExportDimensions(input));
		await flushProbe();
		input.customExportResolution = { width: 2400, height: 1350 };
		input.onCustomExportResolutionChange = vi.fn();
		const changed = hooks.render(() => useExportDimensions(input));
		expect(probes.probe).toHaveBeenCalledTimes(1);
		expect(changed.supportedMp4SourceDimensions.encoderPath).toEqual(encoderPath);
		await changed.ensureSupportedMp4SourceDimensions(30, "custom");
		expect(probes.probe).toHaveBeenLastCalledWith(
			expect.objectContaining({ width: 2400, height: 1350 }),
		);
	});
	it("ignores an older source probe after a real frame-rate change", async () => {
		const input = sourceInput();
		let old!: (value: unknown) => void;
		let current!: (value: unknown) => void;
		probes.probe
			.mockReturnValueOnce(
				new Promise((resolve) => {
					old = resolve;
				}),
			)
			.mockReturnValueOnce(
				new Promise((resolve) => {
					current = resolve;
				}),
			);
		hooks.render(() => useExportDimensions(input));
		input.mp4FrameRate = 60;
		hooks.render(() => useExportDimensions(input));
		const expected = { width: 1280, height: 720, capped: true, encoderPath };
		current(expected);
		await flushProbe();
		old({ width: 640, height: 360, capped: true, encoderPath });
		await flushProbe();
		expect(hooks.render(() => useExportDimensions(input)).supportedMp4SourceDimensions).toEqual(
			expected,
		);
		expect(probes.probe).toHaveBeenCalledTimes(2);
	});
	it("does not publish a probe result after unmount", async () => {
		let resolve!: (value: unknown) => void;
		probes.probe.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		hooks.render(() => useExportDimensions(sourceInput()));
		hooks.dispose();
		const writes = hooks.writes();
		resolve({ width: 640, height: 360, capped: true, encoderPath });
		await flushProbe();
		expect(hooks.writes()).toBe(writes);
	});
});
