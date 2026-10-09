import { type ClipRegion, getTimelineDurationMs, sortClipRegions } from "../../types";
import { type EditorOpMap, rejectUnknown, requireFiniteNumber, requireObject } from "./types";

export const MIN_TRANSITION_MS = 100;
export const MAX_TRANSITION_MS = 2000;
export const BOUNDARY_SNAP_MS = 250;

export type TransitionKind = "dip";

export type ClipTransition = {
	id: string;
	kind: TransitionKind;
	ms: number;
	afterClipId: string;
};

export type TimelineDip = { atMs: number; ms: number };

type Boundary = {
	index: number;
	atMs: number;
	outgoing: ClipRegion;
	incoming: ClipRegion;
	snappedFromMs?: number;
};

const NO_CLIPS =
	"The timeline has no clips yet. Wait for the recording to finish loading, then try again.";

const ONE_CLIP =
	"The edit is a single clip, so there is no cut between clips to put a transition on. Split it with timeline.split, or add footage with timeline.join, first.";

const NO_DIPS: TimelineDip[] = [];
Object.freeze(NO_DIPS);
let lastDips: TimelineDip[] = NO_DIPS;
let lastDipSignature = "";

// sameRendererConfig compares render options by identity, so an unchanged result must stay one array.
function stableDips(dips: TimelineDip[]): TimelineDip[] {
	if (dips.length === 0) return NO_DIPS;
	const signature = JSON.stringify(dips);
	if (signature === lastDipSignature) return lastDips;
	lastDipSignature = signature;
	lastDips = dips;
	return dips;
}

export function resolveTimelineDips(
	clips: ClipRegion[],
	transitions: ClipTransition[] | undefined,
): TimelineDip[] {
	if (!transitions || transitions.length === 0) return NO_DIPS;
	const ordered = sortClipRegions(clips);
	const taken = new Set<number>();
	const dips: TimelineDip[] = [];
	for (const transition of transitions) {
		if (transition.kind !== "dip" || !(transition.ms > 0)) continue;
		const index = ordered.findIndex((clip) => clip.id === transition.afterClipId);
		if (index < 1 || taken.has(index)) continue;
		const incoming = ordered[index];
		const outgoing = ordered[index - 1];
		const half = Math.min(
			transition.ms / 2,
			incoming.endMs - incoming.startMs,
			outgoing.endMs - outgoing.startMs,
		);
		if (!(half > 0)) continue;
		taken.add(index);
		dips.push({ atMs: incoming.startMs, ms: half * 2 });
	}
	return stableDips(dips);
}

export function dipAlphaAt(dips: TimelineDip[] | undefined, timeMs: number): number {
	let alpha = 0;
	for (const dip of dips ?? []) {
		const half = dip.ms / 2;
		if (!(half > 0)) continue;
		const distance = Math.abs(timeMs - dip.atMs);
		if (distance >= half) continue;
		alpha = Math.max(alpha, 1 - distance / half);
	}
	return alpha;
}

export function paintDip(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	alpha: number,
): boolean {
	if (!(alpha > 0) || !(width > 0) || !(height > 0)) return false;
	context.save();
	context.globalAlpha = Math.min(1, alpha);
	context.globalCompositeOperation = "source-over";
	context.fillStyle = "#000000";
	context.fillRect(0, 0, width, height);
	context.restore();
	return true;
}

function requireKind(value: unknown): TransitionKind {
	if (value === "dip") return "dip";
	if (value === "crossfade") {
		throw new Error(
			'timeline.transition cannot do a crossfade. The export decodes one frame at a time, so the tail of the outgoing clip and the head of the incoming one are never in hand together, and nothing can blend them. Use kind "dip", which fades out through black and back in and needs no second frame.',
		);
	}
	throw new Error(
		'kind must be "dip": a fade out through black and back in, centred on the cut. A crossfade is not available.',
	);
}

function requireMs(value: unknown): number {
	const ms = Math.round(requireFiniteNumber(value, "ms"));
	if (ms === 0) return 0;
	if (ms < 0) {
		throw new Error(
			`ms is ${ms}, which is no length at all. Pass 0 to remove the transition on this cut, or ${MIN_TRANSITION_MS} to ${MAX_TRANSITION_MS} to set one.`,
		);
	}
	if (ms < MIN_TRANSITION_MS) {
		throw new Error(
			`ms ${ms} is under ${MIN_TRANSITION_MS} ms, short enough to read as a flicker rather than a transition. Pass 0 to remove the transition, or ${MIN_TRANSITION_MS} to ${MAX_TRANSITION_MS}.`,
		);
	}
	if (ms > MAX_TRANSITION_MS) {
		throw new Error(
			`ms ${ms} is over ${MAX_TRANSITION_MS} ms, long enough on black to look like a stall. Pass ${MIN_TRANSITION_MS} to ${MAX_TRANSITION_MS}.`,
		);
	}
	return ms;
}

function requireBoundary(args: Record<string, unknown>, clips: ClipRegion[]): Boundary {
	const byIndex = args.betweenClips !== undefined;
	const byTime = args.atMs !== undefined;
	if (byIndex === byTime) {
		throw new Error(
			"timeline.transition needs exactly one of atMs, a timeline millisecond on the cut, or betweenClips, the index of the clip the cut runs into.",
		);
	}
	const options = clips.slice(1).map((incoming, offset) => ({
		index: offset + 1,
		atMs: incoming.startMs,
		outgoing: clips[offset],
		incoming,
	}));
	if (byIndex) {
		const index = requireFiniteNumber(args.betweenClips, "betweenClips");
		const found = Number.isInteger(index)
			? options.find((option) => option.index === index)
			: undefined;
		if (!found) {
			throw new Error(
				`betweenClips must be a whole number from 1 to ${clips.length - 1}: the index, in timeline order, of the clip the cut runs into. The edit has ${clips.length} clips, so it has ${clips.length - 1} cut${clips.length === 2 ? "" : "s"}.`,
			);
		}
		return found;
	}
	const atMs = requireFiniteNumber(args.atMs, "atMs");
	const nearest = options.reduce((best, option) =>
		Math.abs(option.atMs - atMs) < Math.abs(best.atMs - atMs) ? option : best,
	);
	const offBy = Math.abs(nearest.atMs - atMs);
	if (offBy > BOUNDARY_SNAP_MS) {
		throw new Error(
			`atMs ${Math.round(atMs)} is ${Math.round(offBy)} ms from the nearest cut, which is at ${nearest.atMs} ms running into clip ${nearest.index}, further than the ${BOUNDARY_SNAP_MS} ms a transition snaps. A transition sits on a cut between two clips, never inside one: pass ${nearest.atMs}, or betweenClips ${nearest.index}.`,
		);
	}
	const rounded = Math.round(atMs);
	return { ...nearest, ...(rounded !== nearest.atMs && { snappedFromMs: rounded }) };
}

export const transitionOps: EditorOpMap = {
	"timeline.transition": (payload, context) => {
		const args = requireObject(payload, "timeline.transition");
		rejectUnknown(args, ["atMs", "betweenClips", "kind", "ms"], "timeline.transition");
		const clips = sortClipRegions(context.timeline.clipRegions);
		if (clips.length === 0) throw new Error(NO_CLIPS);
		if (clips.length === 1) throw new Error(ONE_CLIP);
		const kind = requireKind(args.kind);
		const ms = requireMs(args.ms);
		const boundary = requireBoundary(args, clips);
		const outgoingMs = boundary.outgoing.endMs - boundary.outgoing.startMs;
		const incomingMs = boundary.incoming.endMs - boundary.incoming.startMs;
		const shortestMs = Math.min(outgoingMs, incomingMs);
		const halfMs = ms / 2;
		if (ms > 0 && halfMs > shortestMs) {
			throw new Error(
				`A ${ms} ms dip takes ${halfMs} ms off the end of clip ${boundary.index - 1} and ${halfMs} ms off the start of clip ${boundary.index}, but the shorter of those two clips only runs ${shortestMs} ms. A transition takes its time from the clips it joins and adds none, so ask for ${Math.floor(shortestMs * 2)} ms or less. Nothing was changed.`,
			);
		}
		const { setTransitions } = context.timeline;
		const current = context.timeline.transitions ?? [];
		const id = `dip-${boundary.incoming.id}`;
		const replaced = current.find((transition) => transition.id === id);
		const durationMs = getTimelineDurationMs(clips, Math.round(context.duration * 1000));
		const where = {
			atMs: boundary.atMs,
			betweenClips: boundary.index,
			durationMs,
			...(boundary.snappedFromMs !== undefined && { snappedFromMs: boundary.snappedFromMs }),
		};
		if (ms === 0) {
			if (!replaced) {
				return {
					...where,
					changed: false,
					note: `The cut at ${boundary.atMs} ms carries no transition, so nothing was removed.`,
				};
			}
			setTransitions(current.filter((transition) => transition.id !== id));
			return { ...where, changed: true, removed: replaced.ms };
		}
		setTransitions([
			...current.filter((transition) => transition.id !== id),
			{ id, kind, ms, afterClipId: boundary.incoming.id },
		]);
		return {
			...where,
			changed: true,
			kind,
			ms,
			...(replaced && { replaced: replaced.ms }),
			note: `A ${ms} ms dip through black on the cut at ${boundary.atMs} ms: the picture darkens over the last ${halfMs} ms of clip ${boundary.index - 1} and lifts over the first ${halfMs} ms of clip ${boundary.index}. It takes its time from those two clips and adds none, so the edit still runs ${durationMs} ms. This is a dip, not a crossfade: the two clips never appear at once.`,
		};
	},
};
