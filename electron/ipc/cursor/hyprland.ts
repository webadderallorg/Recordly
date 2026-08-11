import net from "node:net";
import path from "node:path";
import { resolveLinuxWindowSystem } from "../../linuxWindowSystem";
import { CURSOR_SAMPLE_INTERVAL_MS } from "../constants";
import { linuxCursorScreenPoint, setLinuxCursorScreenPoint } from "../state";

const MAX_RESPONSE_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 250;
const PROVIDER_FRESHNESS_INTERVALS = 3;
// Calibration against Hyprland portal recordings showed cursor telemetry 300 ms early.
export const HYPRLAND_CURSOR_MEDIA_OFFSET_MS = 300;

type CursorPoint = { x: number; y: number };
type QueryCursorPoint = (socketPath: string) => Promise<CursorPoint | null>;

let pollTimer: NodeJS.Timeout | null = null;
let pollGeneration = 0;
let providerHealthyUntilMs = 0;

export function resolveHyprlandCursorCaptureEpochMs(mediaTimelineStartedAtEpochMs: number) {
	return Math.max(0, mediaTimelineStartedAtEpochMs - HYPRLAND_CURSOR_MEDIA_OFFSET_MS);
}

export function getHyprlandRequestSocketPath(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform | string = process.platform,
) {
	if (resolveLinuxWindowSystem(platform, env) !== "wayland") {
		return null;
	}

	const runtimeDir = env.XDG_RUNTIME_DIR?.trim();
	const instanceSignature = env.HYPRLAND_INSTANCE_SIGNATURE?.trim();
	if (
		!runtimeDir ||
		!path.isAbsolute(runtimeDir) ||
		!instanceSignature ||
		!/^[A-Za-z0-9_.-]+$/.test(instanceSignature)
	) {
		return null;
	}

	return path.join(runtimeDir, "hypr", instanceSignature, ".socket.sock");
}

export function parseHyprlandCursorPosition(response: string): CursorPoint | null {
	try {
		const parsed = JSON.parse(response) as { x?: unknown; y?: unknown };
		if (
			typeof parsed.x !== "number" ||
			!Number.isFinite(parsed.x) ||
			typeof parsed.y !== "number" ||
			!Number.isFinite(parsed.y)
		) {
			return null;
		}

		return { x: parsed.x, y: parsed.y };
	} catch {
		return null;
	}
}

export function queryHyprlandCursorPosition(socketPath: string): Promise<CursorPoint | null> {
	return new Promise((resolve) => {
		let output = "";
		let settled = false;
		const socket = net.createConnection(socketPath);

		const finish = (point: CursorPoint | null) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(point);
		};

		socket.setEncoding("utf8");
		socket.setTimeout(REQUEST_TIMEOUT_MS, () => finish(null));
		socket.once("connect", () => socket.end("j/cursorpos"));
		socket.on("data", (chunk: string) => {
			output += chunk;
			if (Buffer.byteLength(output) > MAX_RESPONSE_BYTES) {
				finish(null);
			}
		});
		socket.once("end", () => finish(parseHyprlandCursorPosition(output)));
		socket.once("error", () => finish(null));
		socket.once("close", () => finish(null));
	});
}

function clearHyprlandCursorPoint() {
	if (linuxCursorScreenPoint?.source === "hyprland") {
		setLinuxCursorScreenPoint(null);
	}
}

export function stopHyprlandCursorProvider() {
	pollGeneration += 1;
	providerHealthyUntilMs = 0;
	if (pollTimer) {
		clearTimeout(pollTimer);
		pollTimer = null;
	}
	clearHyprlandCursorPoint();
}

export async function startHyprlandCursorProvider(options?: {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform | string;
	pollIntervalMs?: number;
	query?: QueryCursorPoint;
	onPoint?: (point: CursorPoint) => void;
}) {
	stopHyprlandCursorProvider();

	const socketPath = getHyprlandRequestSocketPath(
		options?.env ?? process.env,
		options?.platform ?? process.platform,
	);
	if (!socketPath) {
		return false;
	}

	const generation = pollGeneration;
	const query = options?.query ?? queryHyprlandCursorPosition;
	const pollIntervalMs = options?.pollIntervalMs ?? CURSOR_SAMPLE_INTERVAL_MS;
	const onPoint =
		options?.onPoint ??
		((point: CursorPoint) => {
			setLinuxCursorScreenPoint({
				...point,
				updatedAt: Date.now(),
				coordinateSpace: "logical",
				source: "hyprland",
			});
		});
	const markHealthy = () => {
		providerHealthyUntilMs =
			Date.now() +
			Math.max(
				REQUEST_TIMEOUT_MS + pollIntervalMs,
				pollIntervalMs * PROVIDER_FRESHNESS_INTERVALS,
			);
	};
	const queryPoint = async () => {
		try {
			return await query(socketPath);
		} catch {
			return null;
		}
	};

	const initialPoint = await queryPoint();
	if (generation !== pollGeneration || !initialPoint) {
		return false;
	}
	markHealthy();
	onPoint(initialPoint);

	let nextPollAtMs = performance.now() + pollIntervalMs;
	const poll = async () => {
		const pollStartedAtMs = performance.now();
		const point = await queryPoint();
		if (generation !== pollGeneration) {
			return;
		}

		if (point) {
			markHealthy();
			onPoint(point);
		} else {
			providerHealthyUntilMs = 0;
			clearHyprlandCursorPoint();
		}

		nextPollAtMs += pollIntervalMs;
		const nowMs = performance.now();
		if (nextPollAtMs <= pollStartedAtMs || nextPollAtMs < nowMs - pollIntervalMs) {
			nextPollAtMs = nowMs + pollIntervalMs;
		}
		pollTimer = setTimeout(poll, Math.max(1, nextPollAtMs - nowMs));
	};

	pollTimer = setTimeout(poll, pollIntervalMs);
	return true;
}

export function isHyprlandCursorProviderActive() {
	return providerHealthyUntilMs > Date.now();
}
