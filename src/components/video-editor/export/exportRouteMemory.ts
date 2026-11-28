import {
	applyRememberedRoutes,
	getExportDeviceFingerprint,
	markRouteProbed,
	type RememberedExportRoute,
	readRememberedRoutes,
	readRouteHealthEntry,
	releaseRoutes,
	rememberRoutes,
	routesProvenByExport,
} from "@/lib/exporter/exportRouteHealth";
import {
	probeHardwareH264Encode,
	probeHardwareVideoDecode,
} from "@/lib/exporter/exportRouteProbes";
import type { VideoExporterConfig } from "@/lib/exporter/modernVideoExporterConfig";
import type { ExportResult } from "@/lib/exporter/types";

/** Only exports still running after this long pay for a background re-test. */
export const LONG_EXPORT_PROBE_DELAY_MS = 20_000;
/** Re-test a remembered route at most this often, even across many long exports. */
const PROBE_INTERVAL_MS = 12 * 60 * 60 * 1000;

type RecordDiagnostic = (event: string, details?: { [key: string]: unknown }) => void;

type Probe = (config: VideoExporterConfig, signal: AbortSignal) => Promise<boolean>;

/**
 * Faithful probes only: a route without one (WebGPU, FFmpeg, the compatibility
 * pipeline) is released by its expiry instead of by a check that proves nothing.
 */
const PROBES: Partial<{ [route in RememberedExportRoute]: Probe }> = {
	"software-video-decode": (config, signal) => probeHardwareVideoDecode(config.videoUrl, signal),
	"rawvideo-native": (config, signal) =>
		probeHardwareH264Encode(
			{
				width: config.width,
				height: config.height,
				frameRate: config.frameRate,
				bitrate: config.bitrate,
				annexB: true,
			},
			signal,
		),
	"software-encoding": (config, signal) =>
		probeHardwareH264Encode(
			{
				width: config.width,
				height: config.height,
				frameRate: config.frameRate,
				bitrate: config.bitrate,
				codec: config.codec,
				annexB: false,
			},
			signal,
		),
};

/**
 * Starts an export on the routes that rescued this device before, re-tests the
 * fast path during long exports, and updates the memory from the outcome.
 */
export function prepareExportRouteMemory(options: {
	config: VideoExporterConfig;
	delivery: "download" | "cloud";
	record: RecordDiagnostic;
	/** Smoke and benchmark runs need the routes they asked for. */
	enabled: boolean;
	now?: () => number;
}) {
	const now = options.now ?? Date.now;
	if (!options.enabled) {
		return {
			config: options.config,
			initialRoute: undefined,
			startBackgroundProbe: (): void => undefined,
			finish: (_outcome: FinishedExport): void => undefined,
		};
	}
	const fingerprint = getExportDeviceFingerprint();
	const remembered = readRememberedRoutes(fingerprint, now());
	const { config, initialRoute, applied } = applyRememberedRoutes(
		options.config,
		remembered,
		options.delivery,
	);
	if (applied.length > 0) options.record("route-memory-applied", { routes: applied });

	let probeTimer: ReturnType<typeof setTimeout> | undefined;
	const probeController = new AbortController();
	const runProbes = async () => {
		for (const route of applied) {
			const probe = PROBES[route];
			const entry = readRouteHealthEntry(route);
			if (!probe || probeController.signal.aborted) continue;
			if (entry?.lastProbedAt !== undefined && now() - entry.lastProbedAt < PROBE_INTERVAL_MS)
				continue;
			const healthy = await probe(config, probeController.signal).catch(() => false);
			// A probe cut short by the export finishing proves nothing; re-test next time.
			if (probeController.signal.aborted) return;
			markRouteProbed(route, now());
			options.record("route-memory-probe", { route, healthy });
			// The current export keeps its safe route; the next one tries the fast path.
			if (healthy) releaseRoutes([route], now());
		}
	};

	return {
		config,
		initialRoute,
		startBackgroundProbe() {
			if (!applied.some((route) => PROBES[route])) return;
			probeTimer = setTimeout(() => void runProbes(), LONG_EXPORT_PROBE_DELAY_MS);
		},
		finish(outcome: FinishedExport) {
			clearTimeout(probeTimer);
			probeController.abort();
			if (outcome.cancelled) return;
			if (outcome.result.success) {
				const recorded = rememberRoutes(
					routesProvenByExport(outcome.result, outcome.recoveryRoute),
					fingerprint,
					now(),
				);
				if (recorded.length > 0)
					options.record("route-memory-recorded", { routes: recorded });
				return;
			}
			// A remembered route that fails no longer earns the export's trust. The fast
			// path gets the next attempt and is remembered again only if it fails again.
			if (applied.length > 0) {
				releaseRoutes(applied, now());
				options.record("route-memory-released", { routes: applied });
			}
		},
	};
}

export interface FinishedExport {
	result: ExportResult;
	recoveryRoute?: "software" | "compatibility" | null;
	cancelled: boolean;
}
