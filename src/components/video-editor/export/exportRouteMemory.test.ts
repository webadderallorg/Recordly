import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoExporterConfig } from "@/lib/exporter/modernVideoExporterConfig";
import { LONG_EXPORT_PROBE_DELAY_MS, prepareExportRouteMemory } from "./exportRouteMemory";

const probes = vi.hoisted(() => ({
	decode: vi.fn(async (_url: string, _signal: AbortSignal) => true),
	encode: vi.fn(async (_options: unknown, _signal: AbortSignal) => true),
}));
vi.mock("@/lib/exporter/exportRouteProbes", () => ({
	probeHardwareVideoDecode: probes.decode,
	probeHardwareH264Encode: probes.encode,
}));

const config = {
	videoUrl: "file:///recording.mp4",
	width: 1280,
	height: 680,
	frameRate: 60,
	bitrate: 12_000_000,
	codec: "avc1.640034",
	backendPreference: "auto",
} as VideoExporterConfig;
const softwareDecodeSuccess = {
	success: true,
	metrics: { totalElapsedMs: 1, fallbacks: ["software-video-decode" as const] },
};

let now = 0;
function prepare(record = vi.fn(), enabled = true) {
	return {
		record,
		memory: prepareExportRouteMemory({
			config,
			delivery: "download",
			record,
			enabled,
			now: () => now,
		}),
	};
}

beforeEach(() => {
	now = 1_000_000;
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
	});
	vi.useFakeTimers();
	probes.decode.mockReset().mockResolvedValue(true);
	probes.encode.mockReset().mockResolvedValue(true);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("export route memory", () => {
	it("starts the next export on the fallback that rescued this one", () => {
		const first = prepare();
		expect(first.memory.config).toEqual(config);
		first.memory.finish({ result: softwareDecodeSuccess, cancelled: false });
		expect(first.record).toHaveBeenCalledWith("route-memory-recorded", {
			routes: ["software-video-decode"],
		});

		const next = prepare();
		expect(next.memory.config.forceSoftwareVideoDecode).toBe(true);
		expect(next.record).toHaveBeenCalledWith("route-memory-applied", {
			routes: ["software-video-decode"],
		});
	});

	it("remembers the outer recovery route too", () => {
		prepare().memory.finish({
			result: { success: true },
			recoveryRoute: "compatibility",
			cancelled: false,
		});
		expect(prepare().memory.initialRoute).toBe("compatibility");
	});

	it("re-tests the fast path during a long export and lets the next export use it", async () => {
		prepare().memory.finish({ result: softwareDecodeSuccess, cancelled: false });
		const { memory, record } = prepare();
		memory.startBackgroundProbe();
		await vi.advanceTimersByTimeAsync(LONG_EXPORT_PROBE_DELAY_MS - 1);
		expect(probes.decode).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(probes.decode).toHaveBeenCalledWith(config.videoUrl, expect.any(AbortSignal));
		expect(record).toHaveBeenCalledWith("route-memory-probe", {
			route: "software-video-decode",
			healthy: true,
		});
		memory.finish({ result: { success: true }, cancelled: false });
		expect(prepare().memory.config.forceSoftwareVideoDecode).toBeUndefined();
	});

	it("keeps the safe route when the re-test fails, and waits 12 hours to re-test again", async () => {
		probes.decode.mockResolvedValue(false);
		prepare().memory.finish({ result: softwareDecodeSuccess, cancelled: false });
		for (const hoursLater of [0, 6, 12]) {
			now += hoursLater * 60 * 60 * 1000;
			const { memory } = prepare();
			memory.startBackgroundProbe();
			await vi.advanceTimersByTimeAsync(LONG_EXPORT_PROBE_DELAY_MS);
			memory.finish({ result: { success: true }, cancelled: false });
			expect(memory.config.forceSoftwareVideoDecode).toBe(true);
		}
		expect(probes.decode).toHaveBeenCalledTimes(2);
	});

	it("does not probe a short export or a route without a faithful probe", async () => {
		prepare().memory.finish({
			result: {
				success: true,
				metrics: {
					totalElapsedMs: 1,
					fallbacks: ["software-video-decode", "webgl-renderer"],
				},
			},
			cancelled: false,
		});
		const short = prepare().memory;
		short.startBackgroundProbe();
		await vi.advanceTimersByTimeAsync(LONG_EXPORT_PROBE_DELAY_MS - 1);
		short.finish({ result: { success: true }, cancelled: false });
		await vi.advanceTimersByTimeAsync(LONG_EXPORT_PROBE_DELAY_MS);
		expect(probes.decode).not.toHaveBeenCalled();
		expect(probes.encode).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("drops a remembered route that failed, but not on cancellation", () => {
		prepare().memory.finish({ result: softwareDecodeSuccess, cancelled: false });
		prepare().memory.finish({ result: { success: false }, cancelled: true });
		expect(prepare().memory.config.forceSoftwareVideoDecode).toBe(true);

		const failed = prepare();
		failed.memory.finish({ result: { success: false, error: "boom" }, cancelled: false });
		expect(failed.record).toHaveBeenCalledWith("route-memory-released", {
			routes: ["software-video-decode"],
		});
		expect(prepare().memory.config.forceSoftwareVideoDecode).toBeUndefined();
	});

	it("leaves smoke and benchmark exports on the routes they asked for", () => {
		prepare().memory.finish({ result: softwareDecodeSuccess, cancelled: false });
		const { memory, record } = prepare(vi.fn(), false);
		expect(memory.config).toBe(config);
		memory.finish({ result: softwareDecodeSuccess, cancelled: false });
		expect(record).not.toHaveBeenCalled();
	});
});

it("re-tests again after a probe that the export's end cut short", async () => {
	vi.useFakeTimers();
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
	});
	try {
		probes.decode
			.mockReset()
			.mockImplementation(
				(_url, signal) =>
					new Promise<boolean>((resolve) =>
						signal.addEventListener("abort", () => resolve(false), { once: true }),
					),
			);
		prepare().memory.finish({ result: softwareDecodeSuccess, cancelled: false });
		const first = prepare().memory;
		first.startBackgroundProbe();
		await vi.advanceTimersByTimeAsync(LONG_EXPORT_PROBE_DELAY_MS);
		first.finish({ result: { success: true }, cancelled: false });
		const second = prepare().memory;
		second.startBackgroundProbe();
		await vi.advanceTimersByTimeAsync(LONG_EXPORT_PROBE_DELAY_MS);
		second.finish({ result: { success: true }, cancelled: false });
		expect(probes.decode).toHaveBeenCalledTimes(2);
	} finally {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	}
});
