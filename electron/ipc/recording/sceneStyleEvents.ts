import fs from "node:fs/promises";

export type SceneStyleMode = "fill" | "framed";

export interface SceneStyleEvent {
	timeMs: number;
	mode: SceneStyleMode;
}

let sessionEvents: SceneStyleEvent[] | null = null;

export function getSceneStyleEventsPath(videoPath: string): string {
	return `${videoPath}.scene-style-events.json`;
}

export function beginSceneStyleSession(): void {
	sessionEvents = [];
}

function isValidEvent(event: SceneStyleEvent): boolean {
	return (
		Number.isFinite(event?.timeMs) &&
		event.timeMs >= 0 &&
		(event.mode === "fill" || event.mode === "framed")
	);
}

export function recordSceneStyleEvent(event: SceneStyleEvent): void {
	if (!sessionEvents || !isValidEvent(event)) {
		return;
	}
	sessionEvents.push({ timeMs: Math.round(event.timeMs), mode: event.mode });
}

/**
 * Writes the sidecar next to a finalized video. No-op without events.
 *
 * Does NOT clear the session: finalize runs once per output file of the same
 * recording (the screen video AND the separate webcam video), and the editor
 * looks for the sidecar next to the screen video — every finalized file gets
 * a copy. The session is cleared by the next beginSceneStyleSession().
 */
export async function persistSceneStyleEvents(videoPath: string): Promise<void> {
	const events = sessionEvents;
	if (!events || events.length === 0) {
		return;
	}
	try {
		await fs.writeFile(
			getSceneStyleEventsPath(videoPath),
			JSON.stringify({ version: 1, events }),
			"utf8",
		);
	} catch (error) {
		console.warn("[scene-style] Failed to persist scene style events:", error);
	}
}

/** Reads the sidecar next to a video; missing/corrupt sidecars yield []. */
export async function readSceneStyleEvents(videoPath: string): Promise<SceneStyleEvent[]> {
	try {
		const raw = await fs.readFile(getSceneStyleEventsPath(videoPath), "utf8");
		const parsed = JSON.parse(raw) as { events?: SceneStyleEvent[] };
		return Array.isArray(parsed.events) ? parsed.events.filter(isValidEvent) : [];
	} catch {
		return [];
	}
}
