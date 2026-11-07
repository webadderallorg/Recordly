import { createConnection, type Socket } from "node:net";
import path from "node:path";
import { CURSOR_SAMPLE_INTERVAL_MS } from "../constants";

type CursorPoint = { x: number; y: number };

export function getHyprlandSocketPath(
	platform = process.platform,
	env = process.env,
): string | null {
	if (platform !== "linux" || !env.HYPRLAND_INSTANCE_SIGNATURE || !env.XDG_RUNTIME_DIR) {
		return null;
	}
	return path.join(env.XDG_RUNTIME_DIR, "hypr", env.HYPRLAND_INSTANCE_SIGNATURE, ".socket.sock");
}

export function parseHyprlandCursorPoint(response: string): CursorPoint | null {
	try {
		const point = JSON.parse(response);
		return typeof point?.x === "number" &&
			Number.isFinite(point.x) &&
			typeof point?.y === "number" &&
			Number.isFinite(point.y)
			? { x: point.x, y: point.y }
			: null;
	} catch {
		return null;
	}
}

/** Hyprland returns compositor logical coordinates, not X11 physical pixels. */
export class HyprlandCursorMonitor {
	private socket: Socket | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private point: CursorPoint | null = null;
	private generation = 0;

	getPoint(): CursorPoint | null {
		return this.point;
	}

	start(socketPath: string) {
		this.stop();
		const generation = this.generation;
		let warned = false;

		const poll = () => {
			if (generation !== this.generation) return;
			const socket = createConnection(socketPath);
			this.socket = socket;
			let response = "";
			let succeeded = false;
			socket.setTimeout(1000, () =>
				socket.destroy(new Error("Hyprland cursor query timed out")),
			);
			socket.on("connect", () => socket.write("j/cursorpos"));
			socket.on("data", (chunk) => {
				response += chunk.toString();
				if (response.length > 4096)
					socket.destroy(new Error("Invalid Hyprland cursor response"));
			});
			socket.on("end", () => {
				if (generation !== this.generation) return;
				const point = parseHyprlandCursorPoint(response);
				if (point) {
					this.point = point;
					succeeded = true;
				}
			});
			socket.on("error", () => {
				// Handled on close, including timeout and compositor shutdown.
			});
			socket.on("close", () => {
				if (generation !== this.generation) return;
				this.socket = null;
				if (!succeeded && !warned) {
					warned = true;
					console.warn("[CursorTelemetry] Hyprland cursor query failed; retrying.");
				}
				// One request at a time; back off if the compositor is unavailable.
				this.timer = setTimeout(poll, succeeded ? CURSOR_SAMPLE_INTERVAL_MS : 1000);
			});
		};
		poll();
	}

	stop() {
		this.generation++;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.socket?.destroy();
		this.socket = null;
		this.point = null;
	}
}

export const hyprlandCursorMonitor = new HyprlandCursorMonitor();
