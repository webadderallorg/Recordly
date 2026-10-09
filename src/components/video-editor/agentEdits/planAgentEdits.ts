import { MIN_FRESH_RECORDING_AUTO_ZOOM_SOURCE_ASPECT_RATIO } from "../timeline/zoomSuggestionUtils";
import { clampFocusToDepth, ZOOM_DEPTH_SCALES, type ZoomDepth, type ZoomFocus } from "../types";

export type AgentActivitySpanKind = "motion" | "hold" | "wait";
export type AgentActivityAction =
	| "move"
	| "click"
	| "drag"
	| "scroll"
	| "type"
	| "key"
	| "wait"
	| "raise";

export interface AgentActivityTarget {
	cx: number;
	cy: number;
	width?: number;
	height?: number;
}

export interface AgentActivitySpan {
	kind: AgentActivitySpanKind;
	action: AgentActivityAction;
	startMs: number;
	endMs: number;
	target?: AgentActivityTarget;
}

export interface AgentActivityScene {
	startMs: number;
	endMs: number;
	failed: boolean;
	title?: string;
}

export interface AgentActivityCameraTarget {
	atMs: number;
	x: number;
	y: number;
	width: number;
	height: number;
	label?: string;
}

export interface AgentActivityLog {
	version: 1;
	scenes: AgentActivityScene[];
	spans: AgentActivitySpan[];
	cameraTargets?: AgentActivityCameraTarget[];
	changeTimesMs?: number[];
}

export interface AgentEditKeepRange {
	startMs: number;
	endMs: number;
	/** Playback rate for this source range. Absent or 1 means a plain shot. */
	speed?: number;
}

export interface AgentEditPlan {
	keepRanges: AgentEditKeepRange[];
	zooms: { startMs: number; endMs: number; depth: ZoomDepth; focus: ZoomFocus }[];
	captions: { startMs: number; endMs: number; text: string }[];
}

export const MOTION_LEAD_MS = 700;
export const MOTION_TAIL_MS = 400;
export const WAIT_KEEP_HEAD_MS = 1200;
export const WAIT_KEEP_TAIL_MS = 300;
export const HOLD_KEEP_MS = 800;
export const HOLD_READ_KEEP_MS = 1200;
export const HOLD_READ_KEEP_MAX_MS = 4000;
export const KEEP_MERGE_GAP_MS = 250;
export const MERGE_CUT_GAP_MS = 1200;
export const MIN_SHOT_MS = 900;
export const RAMP_MAX_GAP_MS = 3000;
export const RAMP_MIN_SPEED = 4;
export const RAMP_MAX_SPEED = 8;
export const RAMP_TARGET_SCREEN_MS = 500;
export const RAMP_EASE_SCREEN_MS = 175;
export const QUIET_RADIUS_MS = 400;
export const QUIET_SNAP_WINDOW_MS = 600;
export const FINAL_TAIL_MS = 1200;
export const MIN_TOTAL_CUT_MS = 500;
export const ZOOM_MAX_AFTER_ACTION_MS = 3000;
export const ZOOM_MIN_DURATION_MS = 1200;
export const ZOOM_KEEP_TAIL_MS = 250;
export const TYPE_INHERITS_CLICK_WITHIN_MS = 2000;
export const ZOOM_SMALL_TARGET_MAX_WIDTH = 0.15;
export const ZOOM_MEDIUM_TARGET_MAX_WIDTH = 0.35;
export const SMALL_TARGET_ZOOM_DEPTH: ZoomDepth = 2;
export const MEDIUM_TARGET_ZOOM_DEPTH: ZoomDepth = 1;
export const ZOOM_MERGE_GAP_MS = 1350;
export const ZOOM_MERGE_FOCUS_DISTANCE = 0.25;
export const ZOOM_MIN_PIECE_MS = 600;
export const CAMERA_MERGE_FOCUS_DISTANCE = 0.05;
export const CAPTION_DURATION_MS = 2500;
export const CAPTION_MAX_CHARS = 80;

type TimeRange = { startMs: number; endMs: number };
type ZoomPlan = AgentEditPlan["zooms"][number];
type ZoomLook = Pick<ZoomPlan, "depth" | "focus">;

const SPAN_KINDS = new Set<AgentActivitySpanKind>(["motion", "hold", "wait"]);

function normalizeTimed<T extends TimeRange>(items: readonly T[] | undefined, durationMs: number) {
	return (Array.isArray(items) ? items : [])
		.filter(
			(item) =>
				item &&
				Number.isFinite(item.startMs) &&
				Number.isFinite(item.endMs) &&
				item.endMs >= item.startMs,
		)
		.map((item) => ({
			...item,
			startMs: Math.max(0, Math.round(item.startMs)),
			endMs: Math.min(durationMs, Math.round(item.endMs)),
		}))
		.filter((item) => item.startMs < durationMs && item.endMs >= item.startMs)
		.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

function mergeRanges(
	ranges: TimeRange[],
	durationMs: number,
	maxGapMs: number = KEEP_MERGE_GAP_MS,
	blocked: TimeRange[] = [],
): TimeRange[] {
	const merged: TimeRange[] = [];
	const clamped = ranges
		.map((range) => ({
			startMs: Math.max(0, range.startMs),
			endMs: Math.min(durationMs, range.endMs),
		}))
		.filter((range) => range.endMs > range.startMs)
		.sort((a, b) => a.startMs - b.startMs);
	for (const range of clamped) {
		const last = merged[merged.length - 1];
		const bridgesACut = blocked.some(
			(cut) => cut.startMs < range.startMs && cut.endMs > (last?.endMs ?? 0),
		);
		if (last && !bridgesACut && range.startMs - last.endMs < maxGapMs) {
			last.endMs = Math.max(last.endMs, range.endMs);
		} else {
			merged.push(range);
		}
	}
	return merged;
}

function quietTimeNear(
	timeMs: number,
	changeTimesMs: number[],
	minMs: number,
	maxMs: number,
): number {
	let best: number | null = null;
	for (let index = 0; index <= changeTimesMs.length; index += 1) {
		const lowMs =
			index === 0 ? Number.NEGATIVE_INFINITY : changeTimesMs[index - 1] + QUIET_RADIUS_MS;
		const highMs =
			index === changeTimesMs.length
				? Number.POSITIVE_INFINITY
				: changeTimesMs[index] - QUIET_RADIUS_MS;
		if (highMs < lowMs) continue;
		const candidate = Math.round(Math.min(Math.max(timeMs, lowMs), highMs));
		if (candidate < minMs || candidate > maxMs) continue;
		if (Math.abs(candidate - timeMs) > QUIET_SNAP_WINDOW_MS) continue;
		if (best === null || Math.abs(candidate - timeMs) < Math.abs(best - timeMs)) {
			best = candidate;
		}
	}
	return best ?? timeMs;
}

function earliestAllowed(cuts: TimeRange[], timeMs: number): number {
	return cuts.reduce(
		(floor, cut) => (cut.endMs <= timeMs ? Math.max(floor, cut.endMs) : floor),
		0,
	);
}

function latestAllowed(cuts: TimeRange[], timeMs: number, durationMs: number): number {
	return cuts.reduce(
		(ceiling, cut) => (cut.startMs >= timeMs ? Math.min(ceiling, cut.startMs) : ceiling),
		durationMs,
	);
}

function snapToQuiet(
	ranges: TimeRange[],
	changeTimesMs: number[],
	durationMs: number,
	cuts: TimeRange[],
): TimeRange[] {
	if (changeTimesMs.length === 0) return ranges;
	return ranges.map((range, index) => {
		const startMs = quietTimeNear(
			range.startMs,
			changeTimesMs,
			Math.max(
				index === 0 ? 0 : ranges[index - 1].endMs,
				earliestAllowed(cuts, range.startMs),
			),
			range.endMs - 1,
		);
		const endMs = quietTimeNear(
			range.endMs,
			changeTimesMs,
			Math.max(range.endMs, startMs + 1),
			Math.min(
				index === ranges.length - 1 ? durationMs : ranges[index + 1].startMs,
				latestAllowed(cuts, range.endMs, durationMs),
			),
		);
		return { startMs, endMs };
	});
}

function extendShortShots(ranges: TimeRange[], durationMs: number, cuts: TimeRange[]): TimeRange[] {
	return ranges.map((range, index) => {
		if (range.endMs - range.startMs >= MIN_SHOT_MS) return range;
		const endMs = Math.min(
			latestAllowed(cuts, range.endMs, durationMs),
			range.startMs + MIN_SHOT_MS,
		);
		const previousEndMs = Math.max(
			index === 0 ? 0 : ranges[index - 1].endMs,
			earliestAllowed(cuts, range.startMs),
		);
		return {
			startMs: Math.max(previousEndMs, Math.min(range.startMs, endMs - MIN_SHOT_MS)),
			endMs,
		};
	});
}

function rampGap(startMs: number, endMs: number): AgentEditKeepRange[] {
	const gapMs = endMs - startMs;
	const speed = Math.min(
		RAMP_MAX_SPEED,
		Math.max(RAMP_MIN_SPEED, Math.round(gapMs / RAMP_TARGET_SCREEN_MS)),
	);
	const easeSpeed = Math.max(2, Math.round(speed / 2));
	const easeMs = Math.min(Math.round(RAMP_EASE_SCREEN_MS * easeSpeed), Math.floor(gapMs / 3));
	if (easeMs <= 0) return [{ startMs, endMs, speed }];
	return [
		{ startMs, endMs: startMs + easeMs, speed: easeSpeed },
		{ startMs: startMs + easeMs, endMs: endMs - easeMs, speed },
		{ startMs: endMs - easeMs, endMs, speed: easeSpeed },
	];
}

function rampShortCuts(
	ranges: TimeRange[],
	blocked: TimeRange[],
	changeTimesMs: number[],
): AgentEditKeepRange[] {
	return ranges.slice(1).flatMap((range, index) => {
		const previous = ranges[index];
		const gapMs = range.startMs - previous.endMs;
		if (gapMs <= 0 || gapMs > RAMP_MAX_GAP_MS) return [];
		if (blocked.some((cut) => cut.startMs < range.startMs && cut.endMs > previous.endMs)) {
			return [];
		}
		if (
			changeTimesMs.length > 0 &&
			!changeTimesMs.some((timeMs) => timeMs > previous.endMs && timeMs < range.startMs)
		) {
			return [];
		}
		return rampGap(previous.endMs, range.startMs);
	});
}

export function holdKeepMs(
	span: AgentActivitySpan,
	previous: AgentActivitySpan | undefined,
): number {
	if (span.kind === "wait") return WAIT_KEEP_HEAD_MS + WAIT_KEEP_TAIL_MS;
	if (previous?.kind !== "wait") return HOLD_KEEP_MS;
	return Math.min(HOLD_READ_KEEP_MAX_MS, Math.max(HOLD_READ_KEEP_MS, span.endMs - span.startMs));
}

function subtractRange<T extends TimeRange>(ranges: T[], cut: TimeRange): T[] {
	return ranges.flatMap((range) => {
		if (cut.endMs <= range.startMs || cut.startMs >= range.endMs) return [range];
		const pieces: T[] = [];
		if (cut.startMs > range.startMs) pieces.push({ ...range, endMs: cut.startMs });
		if (cut.endMs < range.endMs) pieces.push({ ...range, startMs: cut.endMs });
		return pieces;
	});
}

function keptMsBetween(startMs: number, endMs: number, keepRanges: TimeRange[]): number {
	return keepRanges.reduce(
		(sum, range) =>
			sum + Math.max(0, Math.min(endMs, range.endMs) - Math.max(startMs, range.startMs)),
		0,
	);
}

function zoomLookForTarget(target: AgentActivityTarget | undefined): ZoomLook | null {
	if (!target || !Number.isFinite(target.cx) || !Number.isFinite(target.cy)) return null;
	const width = Number.isFinite(target.width) ? Number(target.width) : 0;
	if (width >= ZOOM_MEDIUM_TARGET_MAX_WIDTH) return null;
	const depth =
		width >= ZOOM_SMALL_TARGET_MAX_WIDTH ? MEDIUM_TARGET_ZOOM_DEPTH : SMALL_TARGET_ZOOM_DEPTH;
	return { depth, focus: clampFocusToDepth(target, depth) };
}

function planZooms(spans: AgentActivitySpan[], keepRanges: TimeRange[]): ZoomPlan[] {
	const candidates: ZoomPlan[] = [];
	let lastClick: { endMs: number; look: ZoomLook | null } | null = null;
	for (let index = 0; index < spans.length; index += 1) {
		const span = spans[index];
		if (span.kind !== "motion") continue;
		let look: ZoomLook | null = null;
		if (span.action === "click") {
			look = zoomLookForTarget(span.target);
			lastClick = { endMs: span.endMs, look };
		} else if (
			span.action === "type" &&
			lastClick &&
			span.startMs - lastClick.endMs <= TYPE_INHERITS_CLICK_WITHIN_MS
		) {
			look = lastClick.look;
		}
		if (!look) continue;
		const next = spans[index + 1];
		const followEndMs = !next
			? Number.POSITIVE_INFINITY
			: next.kind === "motion"
				? next.startMs
				: next.endMs;
		const endMs = Math.max(
			span.startMs + ZOOM_MIN_DURATION_MS,
			Math.min(followEndMs, span.endMs + ZOOM_MAX_AFTER_ACTION_MS),
		);
		candidates.push({ startMs: span.startMs, endMs, ...look });
	}

	const merged: ZoomPlan[] = [];
	for (const zoom of candidates) {
		const prev = merged[merged.length - 1];
		if (
			prev &&
			keptMsBetween(prev.endMs, zoom.startMs, keepRanges) < ZOOM_MERGE_GAP_MS &&
			Math.hypot(prev.focus.cx - zoom.focus.cx, prev.focus.cy - zoom.focus.cy) <
				ZOOM_MERGE_FOCUS_DISTANCE
		) {
			prev.endMs = Math.max(prev.endMs, zoom.endMs);
			continue;
		}
		if (prev) prev.endMs = Math.min(prev.endMs, zoom.startMs);
		merged.push({ ...zoom });
	}

	return clipToKept(merged, keepRanges);
}

function clipToKept(zooms: ZoomPlan[], keepRanges: TimeRange[]): ZoomPlan[] {
	return zooms.flatMap((zoom) =>
		keepRanges.flatMap((range) => {
			const startMs = Math.max(zoom.startMs, range.startMs);
			const endMs = Math.min(zoom.endMs, range.endMs - ZOOM_KEEP_TAIL_MS);
			return endMs - startMs >= ZOOM_MIN_PIECE_MS ? [{ ...zoom, startMs, endMs }] : [];
		}),
	);
}

const DEPTHS_BY_SCALE = (Object.keys(ZOOM_DEPTH_SCALES).map(Number) as ZoomDepth[]).sort(
	(a, b) => ZOOM_DEPTH_SCALES[b] - ZOOM_DEPTH_SCALES[a],
);

function cameraLookForTarget(target: AgentActivityCameraTarget): ZoomLook | null {
	const { x, y, width, height } = target;
	if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
	const fitScale = 1 / Math.max(Math.min(width, 1), Math.min(height, 1));
	const depth = DEPTHS_BY_SCALE.find((candidate) => ZOOM_DEPTH_SCALES[candidate] <= fitScale);
	if (depth === undefined) return null;
	return { depth, focus: clampFocusToDepth({ cx: x + width / 2, cy: y + height / 2 }, depth) };
}

function planCameraZooms(
	targets: readonly AgentActivityCameraTarget[] | undefined,
	durationMs: number,
	keepRanges: TimeRange[],
	clickZooms: ZoomPlan[],
): ZoomPlan[] {
	const markers = (Array.isArray(targets) ? targets : [])
		.filter((target) => target && Number.isFinite(target.atMs) && target.atMs < durationMs)
		.map((target) => ({ ...target, atMs: Math.max(0, Math.round(target.atMs)) }))
		.sort((a, b) => a.atMs - b.atMs);
	const regions: ZoomPlan[] = [];
	markers.forEach((marker, index) => {
		const look = cameraLookForTarget(marker);
		if (!look) return;
		const endMs = markers[index + 1]?.atMs ?? durationMs;
		const prev = regions[regions.length - 1];
		if (
			prev &&
			prev.endMs === marker.atMs &&
			prev.depth === look.depth &&
			Math.hypot(prev.focus.cx - look.focus.cx, prev.focus.cy - look.focus.cy) <
				CAMERA_MERGE_FOCUS_DISTANCE
		) {
			prev.endMs = endMs;
			return;
		}
		regions.push({ startMs: marker.atMs, endMs, ...look });
	});
	const free = clickZooms.reduce(subtractRange, regions);
	return clipToKept(free, keepRanges);
}

function planCaptions(
	scenes: AgentActivityScene[],
	keepRanges: TimeRange[],
): AgentEditPlan["captions"] {
	const captions: AgentEditPlan["captions"] = [];
	for (const scene of scenes) {
		const title = typeof scene.title === "string" ? scene.title.trim() : "";
		const text = Array.from(title).slice(0, CAPTION_MAX_CHARS).join("").trim();
		if (scene.failed || !text) continue;
		const range = keepRanges.find((candidate) => candidate.endMs > scene.startMs);
		if (!range || range.startMs >= scene.endMs) continue;
		const startMs =
			range.startMs >= scene.startMs - MOTION_LEAD_MS ? range.startMs : scene.startMs;
		const prev = captions[captions.length - 1];
		if (prev) prev.endMs = Math.min(prev.endMs, startMs);
		captions.push({
			startMs,
			endMs: Math.min(range.endMs, startMs + CAPTION_DURATION_MS),
			text,
		});
	}
	return captions.filter((caption) => caption.endMs > caption.startMs);
}

export function planAgentEdits(
	log: AgentActivityLog | null | undefined,
	durationMs: number,
	sourceAspect: number,
	changeTimesMs?: number[],
): AgentEditPlan | null {
	if (!log || log.version !== 1 || !Number.isFinite(durationMs) || durationMs <= 0) return null;

	const scenes = normalizeTimed(log.scenes, durationMs);
	const failedCuts = scenes.flatMap((scene) => {
		if (!scene.failed) return [];
		const next = scenes.find((other) => other.startMs > scene.startMs);
		const endMs = !next
			? durationMs
			: next.failed
				? next.startMs
				: Math.min(next.startMs, Math.max(scene.endMs, next.startMs - MOTION_LEAD_MS));
		return [{ startMs: scene.startMs, endMs }];
	});
	const spans = normalizeTimed(log.spans, durationMs).filter(
		(span) =>
			SPAN_KINDS.has(span.kind) &&
			!failedCuts.some((cut) => span.startMs >= cut.startMs && span.startMs < cut.endMs),
	);
	if (spans.length === 0) return null;

	const pieces = spans.flatMap((span, index): TimeRange[] => {
		if (span.kind === "motion") {
			return [{ startMs: span.startMs - MOTION_LEAD_MS, endMs: span.endMs + MOTION_TAIL_MS }];
		}
		const keepMs = holdKeepMs(span, spans[index - 1]);
		if (span.endMs - span.startMs <= keepMs) {
			return [{ startMs: span.startMs, endMs: span.endMs }];
		}
		return [
			{ startMs: span.startMs, endMs: span.startMs + keepMs - WAIT_KEEP_TAIL_MS },
			{ startMs: span.endMs - WAIT_KEEP_TAIL_MS, endMs: span.endMs },
		];
	});
	const lastEndMs = spans.reduce((max, span) => Math.max(max, span.endMs), 0);
	pieces.push({ startMs: lastEndMs, endMs: lastEndMs + FINAL_TAIL_MS });
	const cut = failedCuts.reduce(subtractRange, mergeRanges(pieces, durationMs));
	if (cut.length === 0) return null;
	const changeTimes = (Array.isArray(changeTimesMs) ? changeTimesMs : [])
		.filter((timeMs) => Number.isFinite(timeMs))
		.map((timeMs) => Math.round(timeMs))
		.sort((a, b) => a - b);
	const shots = [
		(ranges: TimeRange[]) => mergeRanges(ranges, durationMs, MERGE_CUT_GAP_MS, failedCuts),
		(ranges: TimeRange[]) => snapToQuiet(ranges, changeTimes, durationMs, failedCuts),
		(ranges: TimeRange[]) => extendShortShots(ranges, durationMs, failedCuts),
		(ranges: TimeRange[]) => mergeRanges(ranges, durationMs, MERGE_CUT_GAP_MS, failedCuts),
	].reduce((ranges, step) => step(ranges), cut);
	if (shots.length === 0) return null;

	let zooms: ZoomPlan[] = [];
	if (sourceAspect >= MIN_FRESH_RECORDING_AUTO_ZOOM_SOURCE_ASPECT_RATIO) {
		const clickZooms = planZooms(spans, shots);
		zooms = [
			...clickZooms,
			...planCameraZooms(log.cameraTargets, durationMs, shots, clickZooms),
		].sort((a, b) => a.startMs - b.startMs);
	}
	const captions = planCaptions(scenes, shots);
	const keepRanges: AgentEditKeepRange[] = [
		...shots,
		...rampShortCuts(shots, failedCuts, changeTimes),
	].sort((a, b) => a.startMs - b.startMs);
	const screenMs = keepRanges.reduce(
		(sum, range) => sum + (range.endMs - range.startMs) / (range.speed ?? 1),
		0,
	);
	if (durationMs - screenMs < MIN_TOTAL_CUT_MS && zooms.length === 0 && captions.length === 0) {
		return null;
	}
	return { keepRanges, zooms, captions };
}
