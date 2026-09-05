import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { CURSOR_SAMPLE_INTERVAL_MS } from "../constants";
import { setLinuxCursorScreenPoint } from "../state";
import { getScreen } from "../utils";

const EV_KEY = 1;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const BTN_MIDDLE = 0x112;
const INPUT_EVENT_SIZE = 24;

export function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.XDG_SESSION_TYPE === "wayland" || Boolean(env.WAYLAND_DISPLAY);
}

export function getHyprlandSocketPath(env: NodeJS.ProcessEnv = process.env): string | null {
	const signature = env.HYPRLAND_INSTANCE_SIGNATURE;
	const runtimeDir = env.XDG_RUNTIME_DIR;
	if (!signature || !runtimeDir) {
		return null;
	}
	return path.join(runtimeDir, "hypr", signature, ".socket.sock");
}

export function parseHyprlandCursorPos(raw: string): { x: number; y: number } | null {
	try {
		const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
		if (typeof parsed.x === "number" && typeof parsed.y === "number") {
			return { x: parsed.x, y: parsed.y };
		}
	} catch {
		// Hyprland replied with an error string instead of JSON.
	}
	return null;
}

function requestHyprlandCursorPos(socketPath: string): Promise<{ x: number; y: number } | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		const socket = createConnection(socketPath);
		socket.setTimeout(500);
		socket.on("connect", () => socket.write("j/cursorpos"));
		socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		socket.on("close", () => resolve(parseHyprlandCursorPos(Buffer.concat(chunks).toString())));
		socket.on("timeout", () => socket.destroy());
		socket.on("error", () => resolve(null));
	});
}

function startHyprlandCursorPolling(): (() => void) | null {
	const socketPath = getHyprlandSocketPath();
	if (!socketPath) {
		return null;
	}

	let inFlight = false;
	const timer = setInterval(() => {
		if (inFlight) {
			return;
		}
		inFlight = true;
		void requestHyprlandCursorPos(socketPath).then((point) => {
			inFlight = false;
			if (!point) {
				return;
			}
			// Hyprland reports logical layout coordinates; the telemetry cache expects
			// physical pixels like the X11 hook provides.
			const scale = getScreen().getPrimaryDisplay().scaleFactor || 1;
			setLinuxCursorScreenPoint({
				x: point.x * scale,
				y: point.y * scale,
				updatedAt: Date.now(),
			});
		});
	}, CURSOR_SAMPLE_INTERVAL_MS);

	return () => clearInterval(timer);
}

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

function startEvdevButtonCapture(handlers: {
	onMouseDown: (button: 1 | 2 | 3) => void;
	onMouseUp: () => void;
}): () => void {
	const streams = listMouseEventDevices().map((devicePath) => {
		let pending = Buffer.alloc(0);
		const stream = createReadStream(devicePath);
		stream.on("data", (chunk: Buffer) => {
			pending = Buffer.concat([pending, chunk]);
			const usable = pending.length - (pending.length % INPUT_EVENT_SIZE);
			for (const event of parseEvdevButtonEvents(pending.subarray(0, usable))) {
				if (event.pressed) {
					handlers.onMouseDown(event.button);
				} else {
					handlers.onMouseUp();
				}
			}
			pending = pending.subarray(usable);
		});
		stream.on("error", () => stream.destroy());
		return stream;
	});

	return () => {
		for (const stream of streams) {
			stream.destroy();
		}
	};
}

// ponytail: Hyprland-only pointer position via its IPC socket; other Wayland
// compositors keep falling back to Electron's stale cursor point.
export function startWaylandInteractionCapture(handlers: {
	onMouseDown: (button: 1 | 2 | 3) => void;
	onMouseUp: () => void;
}): (() => void) | null {
	if (process.platform !== "linux" || !isWaylandSession()) {
		return null;
	}

	const stopPolling = startHyprlandCursorPolling();
	const stopButtons = startEvdevButtonCapture(handlers);
	return () => {
		stopPolling?.();
		stopButtons();
	};
}
