import packageInfo from "../../../package.json";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import type { ExportFallback, ExportResult } from "./types";

/**
 * Per-device memory of export routes that needed a slower fallback.
 *
 * A fast path that fails on this device fails the same way next time, and each
 * fallback costs a bounded timeout (8–30 s) at 0%. Remembering the route that
 * rescued the export lets the next export start there. The memory is scoped to
 * this app version, Chromium version and GPU/driver, so an update re-tests the
 * fast path, and it expires: 3 days, doubling each time the same fast path
 * fails again after being re-tested, capped at 14 days.
 */
export type RememberedExportRoute = ExportFallback | "software-encoding" | "compatibility-pipeline";

export interface RouteHealthEntry {
	fingerprint: string;
	recordedAt: number;
	expiresAt: number;
	strikes: number;
	lastProbedAt?: number;
}

interface RouteHealthStore {
	version: 1;
	routes: Partial<Record<RememberedExportRoute, RouteHealthEntry>>;
}

type RouteHealthStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "recordly.exportRouteHealth.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
export const ROUTE_MEMORY_BASE_TTL_MS = 3 * DAY_MS;
export const ROUTE_MEMORY_MAX_TTL_MS = 14 * DAY_MS;
/** A fast path that fails again within this window after release counts as a repeat. */
const STRIKE_WINDOW_MS = 30 * DAY_MS;
const ROUTES: readonly RememberedExportRoute[] = [
	"webgl-renderer",
	"rawvideo-native",
	"webcodecs-encoder",
	"software-video-decode",
	"software-encoding",
	"compatibility-pipeline",
];

function defaultStorage(): RouteHealthStorage | undefined {
	try {
		return globalThis.localStorage ?? undefined;
	} catch {
		return undefined;
	}
}

function readStore(storage = defaultStorage()): RouteHealthStore {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
		if (
			parsed &&
			typeof parsed === "object" &&
			(parsed as RouteHealthStore).version === 1 &&
			typeof (parsed as RouteHealthStore).routes === "object"
		) {
			const routes: RouteHealthStore["routes"] = {};
			for (const route of ROUTES) {
				const entry = (parsed as RouteHealthStore).routes[route];
				if (
					entry &&
					typeof entry.fingerprint === "string" &&
					Number.isFinite(entry.recordedAt) &&
					Number.isFinite(entry.expiresAt) &&
					Number.isInteger(entry.strikes) &&
					entry.strikes > 0
				)
					routes[route] = entry;
			}
			return { version: 1, routes };
		}
	} catch {
		// Unreadable or blocked storage only costs the memory, never the export.
	}
	return { version: 1, routes: {} };
}

function writeStore(store: RouteHealthStore, storage = defaultStorage()) {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(store));
	} catch {
		// Storage may be full or blocked; exporting must not depend on it.
	}
}

function isActive(entry: RouteHealthEntry | undefined, fingerprint: string, now: number) {
	return Boolean(entry && entry.fingerprint === fingerprint && entry.expiresAt > now);
}

export function routeMemoryTtlMs(strikes: number) {
	return Math.min(
		ROUTE_MEMORY_BASE_TTL_MS * 2 ** Math.max(0, strikes - 1),
		ROUTE_MEMORY_MAX_TTL_MS,
	);
}

/** Routes this device should start on now. */
export function readRememberedRoutes(
	fingerprint: string,
	now = Date.now(),
	storage = defaultStorage(),
): RememberedExportRoute[] {
	const { routes } = readStore(storage);
	return ROUTES.filter((route) => isActive(routes[route], fingerprint, now));
}

export function readRouteHealthEntry(
	route: RememberedExportRoute,
	storage = defaultStorage(),
): RouteHealthEntry | undefined {
	return readStore(storage).routes[route];
}

/** Remember fallbacks that rescued a successful export on this device. */
export function rememberRoutes(
	routes: readonly RememberedExportRoute[],
	fingerprint: string,
	now = Date.now(),
	storage = defaultStorage(),
): RememberedExportRoute[] {
	if (routes.length === 0) return [];
	const store = readStore(storage);
	const recorded: RememberedExportRoute[] = [];
	for (const route of new Set(routes)) {
		const previous = store.routes[route];
		if (isActive(previous, fingerprint, now)) continue;
		const repeat =
			previous?.fingerprint === fingerprint && now - previous.recordedAt < STRIKE_WINDOW_MS;
		const strikes = repeat ? previous.strikes + 1 : 1;
		store.routes[route] = {
			fingerprint,
			recordedAt: now,
			expiresAt: now + routeMemoryTtlMs(strikes),
			strikes,
		};
		recorded.push(route);
	}
	for (const route of ROUTES) {
		const entry = store.routes[route];
		if (
			entry &&
			(entry.fingerprint !== fingerprint || now - entry.recordedAt >= STRIKE_WINDOW_MS)
		)
			delete store.routes[route];
	}
	writeStore(store, storage);
	return recorded;
}

/** Let the next export try the fast path again. Strikes stay, so a repeat lasts longer. */
export function releaseRoutes(
	routes: readonly RememberedExportRoute[],
	now = Date.now(),
	storage = defaultStorage(),
) {
	if (routes.length === 0) return;
	const store = readStore(storage);
	for (const route of routes) {
		const entry = store.routes[route];
		if (entry) entry.expiresAt = Math.min(entry.expiresAt, now);
	}
	writeStore(store, storage);
}

export function markRouteProbed(
	route: RememberedExportRoute,
	now = Date.now(),
	storage = defaultStorage(),
) {
	const store = readStore(storage);
	const entry = store.routes[route];
	if (!entry) return;
	entry.lastProbedAt = now;
	writeStore(store, storage);
}

/** Which remembered routes a successful export proved necessary. */
export function routesProvenByExport(
	result: ExportResult,
	recoveryRoute: "software" | "compatibility" | null | undefined,
): RememberedExportRoute[] {
	if (!result.success) return [];
	const routes: RememberedExportRoute[] = [...(result.metrics?.fallbacks ?? [])];
	if (recoveryRoute === "software") routes.push("software-encoding");
	if (recoveryRoute === "compatibility") routes.push("compatibility-pipeline");
	return routes;
}

/**
 * Start on the remembered routes. Explicit choices (a forced render backend or a
 * non-Auto encoder) win over memory. Outer recovery routes describe local exports,
 * so cloud delivery only takes the inner renderer, decoder and raw-frame routes.
 */
export function applyRememberedRoutes(
	config: VideoExporterConfig,
	routes: readonly RememberedExportRoute[],
	delivery: "download" | "cloud",
): {
	config: VideoExporterConfig;
	initialRoute?: "software" | "compatibility";
	applied: RememberedExportRoute[];
} {
	const remembered = new Set(routes);
	const next: VideoExporterConfig = { ...config };
	const applied: RememberedExportRoute[] = [];
	const auto = (config.backendPreference ?? "auto") === "auto";
	if (remembered.has("webgl-renderer") && !config.preferredRenderBackend) {
		next.preferredRenderBackend = "webgl";
		applied.push("webgl-renderer");
	}
	if (remembered.has("software-video-decode")) {
		next.forceSoftwareVideoDecode = true;
		applied.push("software-video-decode");
	}
	if (remembered.has("rawvideo-native")) {
		next.preferRawvideoNative = true;
		applied.push("rawvideo-native");
	}
	if (delivery === "cloud") return { config: next, applied };

	const skipNative = () => {
		next.backendPreference = "webcodecs";
		next.experimentalNativeExport = false;
		next.experimentalNvidiaCudaExport = false;
	};
	if (remembered.has("compatibility-pipeline") && auto) {
		skipNative();
		if (!config.preferredRenderBackend) next.preferredRenderBackend = "webgl";
		applied.push("compatibility-pipeline");
		return { config: next, initialRoute: "compatibility", applied };
	}
	if (remembered.has("software-encoding") && auto) {
		skipNative();
		next.forceSoftwareEncoding = true;
		next.preferredEncoderPath = null;
		applied.push("software-encoding");
		return { config: next, initialRoute: "software", applied };
	}
	if (remembered.has("webcodecs-encoder") && auto) {
		skipNative();
		applied.push("webcodecs-encoder");
	}
	return { config: next, applied };
}

let cachedGpuRenderer: string | undefined;

function readGpuRenderer(): string {
	if (cachedGpuRenderer !== undefined) return cachedGpuRenderer;
	cachedGpuRenderer = "unknown-gpu";
	try {
		if (typeof document === "undefined") return cachedGpuRenderer;
		const gl = document.createElement("canvas").getContext("webgl");
		if (!gl) return cachedGpuRenderer;
		const info = gl.getExtension("WEBGL_debug_renderer_info");
		// ANGLE's renderer string carries the GPU, backend and, on Windows, the driver version.
		const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
		if (typeof renderer === "string" && renderer) cachedGpuRenderer = renderer.slice(0, 200);
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	} catch {
		// A device without GPU details still gets a stable, coarser fingerprint.
	}
	return cachedGpuRenderer;
}

/** Changes when the app, Chromium, platform or GPU/driver changes. Stored locally only. */
export function getExportDeviceFingerprint(): string {
	const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
	const platform = typeof navigator === "undefined" ? "unknown" : navigator.platform || "unknown";
	const chromium = /Chrome\/(\d+)/.exec(userAgent)?.[1] ?? "unknown";
	return [packageInfo.version, platform, `chromium-${chromium}`, readGpuRenderer()].join("|");
}
