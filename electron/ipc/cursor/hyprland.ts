import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { resolveLinuxWindowSystem } from "../../linuxWindowSystem";
import { CURSOR_SAMPLE_INTERVAL_MS } from "../constants";
import { linuxCursorScreenPoint, setLinuxCursorScreenPoint } from "../state";

const MAX_RESPONSE_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 250;
const PROVIDER_FRESHNESS_INTERVALS = 3;
// EXPERIMENTO: offset zerado para medir o desalinhamento real entre a
// telemetria do cursor e o início do vídeo (hipótese: a telemetria inicia
// antes da captura, pois o seletor do portal bloqueia o getUserMedia após
// a contagem). Original do upstream: 300.
export const HYPRLAND_CURSOR_MEDIA_OFFSET_MS = 0;
let lastDebugPosLogAt = 0;

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
			const nowMs = Date.now();
			if (nowMs - lastDebugPosLogAt > 500) {
				lastDebugPosLogAt = nowMs;
				console.log(`[REC-DEBUG] POS ${point.x},${point.y} at ${nowMs}`);
			}
			setLinuxCursorScreenPoint({
				...point,
				updatedAt: nowMs,
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

// ===== Cursor button events via evdev (our addition on top of #808) =====
// Position comes from the Hyprland polling above; buttons need raw input
// device access (user must be in the "input" group).
// Non-blocking reads: a blocking read() on an evdev char device parks a
// libuv threadpool thread (only 4 by default) until the mouse moves — with
// several devices open that starves the pool and hangs the recording save.
// O_NONBLOCK makes read() return immediately (EAGAIN) when there is no data.
const EV_KEY = 1;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const BTN_MIDDLE = 0x112;
const INPUT_EVENT_SIZE = 24;
const EVDEV_POLL_INTERVAL_MS = 20;

export function hasMouseButtonCapability(keyCapabilities: string): boolean {
	const words = keyCapabilities.trim().split(/\s+/);
	const word = words[words.length - 1 - Math.floor(BTN_LEFT / 64)];
	if (!word) {
		return false;
	}
	return ((Number.parseInt(word, 16) >>> (BTN_LEFT % 64)) & 1) === 1;
}

export type EvdevButtonEvent = { button: 1 | 2 | 3; pressed: boolean };

export function parseEvdevButtonEvents(buffer: Buffer): EvdevButtonEvent[] {
	const events: EvdevButtonEvent[] = [];
	for (let offset = 0; offset + INPUT_EVENT_SIZE <= buffer.length; offset += INPUT_EVENT_SIZE) {
		const type = buffer.readUInt16LE(offset + 16);
		const code = buffer.readUInt16LE(offset + 18);
		const value = buffer.readInt32LE(offset + 20);
		if (type !== EV_KEY || value > 1) {
			continue;
		}
		const button =
			code === BTN_LEFT ? 1 : code === BTN_RIGHT ? 2 : code === BTN_MIDDLE ? 3 : null;
		if (button) {
			events.push({ button, pressed: value === 1 });
		}
	}
	return events;
}

function listMouseEventDevices(): string[] {
	try {
		return readdirSync("/sys/class/input")
			.filter((name) => name.startsWith("event"))
			.filter((name) => {
				try {
					const capabilities = readFileSync(
						`/sys/class/input/${name}/device/capabilities/key`,
						"utf-8",
					);
					return hasMouseButtonCapability(capabilities);
				} catch {
					return false;
				}
			})
			.map((name) => `/dev/input/${name}`);
	} catch {
		return [];
	}
}

export function startEvdevButtonCapture(handlers: {
	onMouseDown: (button: 1 | 2 | 3) => void;
	onMouseUp: () => void;
}): () => void {
	// Only Hyprland/Wayland sessions need raw evdev buttons: on X11 the uiohook
	// already captures clicks, and double-counting them corrupts the telemetry.
	if (process.platform !== "linux" || !getHyprlandRequestSocketPath(process.env)) {
		return () => {
			console.log("[REC-DEBUG] evdev capture skipped (no Hyprland session)");
		};
	}
	const stoppers = listMouseEventDevices().map((devicePath) => {
		let fd: number | null = null;
		let timer: NodeJS.Timeout | null = null;
		let stopped = false;
		const buffer = Buffer.alloc(256);
		const stop = () => {
			stopped = true;
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			if (fd !== null) {
				const fdToClose = fd;
				fd = null;
				fs.close(fdToClose, () => {
					console.log(`[REC-DEBUG] evdev closed: ${devicePath}`);
				});
			}
		};
		fs.open(devicePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK, (openError, openedFd) => {
			if (openError || openedFd === undefined) {
				console.log("[REC-DEBUG] evdev open FAILED:", devicePath, openError?.message);
				stop();
				return;
			}
			if (stopped) {
				// stop() ran while fs.open was in flight — close the descriptor
				// immediately instead of leaking it.
				fs.closeSync(openedFd);
				console.log("[REC-DEBUG] evdev closed (stop before open):", devicePath);
				return;
			}
			fd = openedFd;
			console.log("[REC-DEBUG] evdev fd opened:", devicePath);
			timer = setInterval(() => {
				if (stopped || fd === null) {
					clearInterval(timer ?? undefined);
					return;
				}
				fs.read(fd, buffer, 0, buffer.length, null, (readError, bytesRead) => {
					if (stopped || readError || bytesRead <= 0) {
						return;
					}
					for (const event of parseEvdevButtonEvents(buffer.subarray(0, bytesRead))) {
						if (event.pressed) {
							handlers.onMouseDown(event.button);
						} else {
							handlers.onMouseUp();
						}
					}
				});
			}, EVDEV_POLL_INTERVAL_MS);
		});
		return stop;
	});

	return () => {
		for (const stop of stoppers) {
			stop();
		}
	};
}
