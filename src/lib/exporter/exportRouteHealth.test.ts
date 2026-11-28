import { describe, expect, it } from "vitest";
import {
	applyRememberedRoutes,
	markRouteProbed,
	readRememberedRoutes,
	readRouteHealthEntry,
	releaseRoutes,
	rememberRoutes,
	routesProvenByExport,
} from "./exportRouteHealth";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";

const DAY = 24 * 60 * 60 * 1000;
const device = "2.0.0|MacIntel|chromium-142|ANGLE (Apple, M2)";

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
		values,
	};
}

const config = {
	videoUrl: "file:///recording.mp4",
	width: 1920,
	height: 1080,
	frameRate: 60,
	bitrate: 20_000_000,
	codec: "avc1.640034",
	backendPreference: "auto",
	experimentalNativeExport: true,
	preferredEncoderPath: { codec: "avc1.640034", hardwareAcceleration: "prefer-hardware" },
} as VideoExporterConfig;

describe("remembered export routes", () => {
	it("starts later exports on a remembered route until it expires after three days", () => {
		const storage = memoryStorage();
		expect(rememberRoutes(["software-video-decode"], device, 0, storage)).toEqual([
			"software-video-decode",
		]);
		expect(readRememberedRoutes(device, 3 * DAY - 1, storage)).toEqual([
			"software-video-decode",
		]);
		expect(readRememberedRoutes(device, 3 * DAY, storage)).toEqual([]);
	});

	it("re-tests the fast path after an app, Chromium or GPU driver change", () => {
		const storage = memoryStorage();
		rememberRoutes(["webgl-renderer"], device, 0, storage);
		expect(readRememberedRoutes(`${device} driver-update`, DAY, storage)).toEqual([]);
	});

	it("doubles the memory each time a released fast path fails again, up to 14 days", () => {
		const storage = memoryStorage();
		const ttls: number[] = [];
		let now = 0;
		for (let failure = 0; failure < 5; failure++) {
			rememberRoutes(["rawvideo-native"], device, now, storage);
			const entry = readRouteHealthEntry("rawvideo-native", storage)!;
			ttls.push((entry.expiresAt - entry.recordedAt) / DAY);
			// A background probe or the expiry lets the next export try the fast path.
			releaseRoutes(["rawvideo-native"], now + DAY, storage);
			now += 2 * DAY;
		}
		expect(ttls).toEqual([3, 6, 12, 14, 14]);
	});

	it("starts over after a month without the fast path failing", () => {
		const storage = memoryStorage();
		rememberRoutes(["rawvideo-native"], device, 0, storage);
		releaseRoutes(["rawvideo-native"], DAY, storage);
		rememberRoutes(["rawvideo-native"], device, 31 * DAY, storage);
		expect(readRouteHealthEntry("rawvideo-native", storage)?.strikes).toBe(1);
	});

	it("does not extend a route that is still remembered", () => {
		const storage = memoryStorage();
		rememberRoutes(["webgl-renderer"], device, 0, storage);
		expect(rememberRoutes(["webgl-renderer"], device, DAY, storage)).toEqual([]);
		expect(readRouteHealthEntry("webgl-renderer", storage)?.expiresAt).toBe(3 * DAY);
	});

	it("keeps probe times without changing the expiry", () => {
		const storage = memoryStorage();
		rememberRoutes(["software-video-decode"], device, 0, storage);
		markRouteProbed("software-video-decode", DAY, storage);
		expect(readRouteHealthEntry("software-video-decode", storage)).toMatchObject({
			lastProbedAt: DAY,
			expiresAt: 3 * DAY,
		});
	});

	it("ignores corrupt storage and keeps exporting without memory", () => {
		const storage = memoryStorage();
		storage.values.set("recordly.exportRouteHealth.v1", "{not json");
		expect(readRememberedRoutes(device, 0, storage)).toEqual([]);
		const throwing = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
		};
		expect(() => rememberRoutes(["webgl-renderer"], device, 0, throwing)).not.toThrow();
		expect(readRememberedRoutes(device, 0, throwing)).toEqual([]);
	});
});

describe("routes proven by an export", () => {
	it("remembers inner fallbacks and the outer recovery only from a successful export", () => {
		const result = {
			success: true,
			metrics: { totalElapsedMs: 1, fallbacks: ["software-video-decode" as const] },
		};
		expect(routesProvenByExport(result, "compatibility")).toEqual([
			"software-video-decode",
			"compatibility-pipeline",
		]);
		expect(routesProvenByExport({ ...result, success: false }, "software")).toEqual([]);
	});
});

describe("applying remembered routes", () => {
	it("maps inner fallbacks onto the export settings", () => {
		const { config: next, initialRoute } = applyRememberedRoutes(
			config,
			["webgl-renderer", "software-video-decode", "rawvideo-native", "webcodecs-encoder"],
			"download",
		);
		expect(initialRoute).toBeUndefined();
		expect(next).toMatchObject({
			preferredRenderBackend: "webgl",
			forceSoftwareVideoDecode: true,
			preferRawvideoNative: true,
			backendPreference: "webcodecs",
			experimentalNativeExport: false,
		});
		expect(config.backendPreference).toBe("auto");
	});

	it("starts on the remembered outer recovery route", () => {
		expect(applyRememberedRoutes(config, ["software-encoding"], "download")).toMatchObject({
			initialRoute: "software",
			config: { forceSoftwareEncoding: true, preferredEncoderPath: null },
		});
		expect(
			applyRememberedRoutes(
				config,
				["compatibility-pipeline", "software-encoding"],
				"download",
			),
		).toMatchObject({
			initialRoute: "compatibility",
			config: { preferredRenderBackend: "webgl", backendPreference: "webcodecs" },
			applied: ["compatibility-pipeline"],
		});
	});

	it("lets an explicit renderer or encoder choice win over memory", () => {
		const explicit = {
			...config,
			preferredRenderBackend: "webgpu" as const,
			backendPreference: "breeze" as const,
		};
		const { config: next, applied } = applyRememberedRoutes(
			explicit,
			["webgl-renderer", "webcodecs-encoder", "software-encoding"],
			"download",
		);
		expect(next.preferredRenderBackend).toBe("webgpu");
		expect(next.backendPreference).toBe("breeze");
		expect(applied).toEqual([]);
	});

	it("applies only inner routes to cloud delivery", () => {
		const {
			config: next,
			initialRoute,
			applied,
		} = applyRememberedRoutes(
			config,
			["software-video-decode", "webcodecs-encoder", "compatibility-pipeline"],
			"cloud",
		);
		expect(initialRoute).toBeUndefined();
		expect(applied).toEqual(["software-video-decode"]);
		expect(next.backendPreference).toBe("auto");
	});
});
