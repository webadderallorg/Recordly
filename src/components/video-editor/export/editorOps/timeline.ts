import {
	type AgentActivityLog,
	type AgentActivitySpan,
	HOLD_KEEP_MS,
	holdKeepMs,
	MIN_SHOT_MS,
	MOTION_LEAD_MS,
	MOTION_TAIL_MS,
	QUIET_RADIUS_MS,
	RAMP_MAX_SPEED,
	WAIT_KEEP_TAIL_MS,
} from "../../agentEdits/planAgentEdits";
import { appendImportedClip } from "../../clipImport";
import {
	insertClipRegion,
	packClipSequence,
	reorderClipSequence,
	rippleRegionAnchors,
	rippleRegions,
	shiftAnchorsForInsert,
	shiftCaptionCuesForInsert,
	shiftRegionsForInsert,
} from "../../clipSequence";
import { changeClipSpan } from "../../clipSpanChange";
import { planClipSplit } from "../../clipSplit";
import {
	type ClipRegion,
	FREEZE_SOURCE_MS,
	getClipSourceEndMs,
	getClipSourceStartMs,
	getTimelineDurationMs,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	sortClipRegions,
} from "../../types";
import {
	getPreviewPlaybackRateRange,
	supportsPreviewPlaybackRate,
} from "../../videoPlayback/playbackRate";
import {
	type EditorOpContext,
	type EditorOpMap,
	loadAgentActivity,
	nextId,
	rejectUnknown,
	requireFiniteNumber,
	requireObject,
} from "./types";

type Range = { startMs: number; endMs: number };
type Slot = { clip: ClipRegion; duration: number; sourceLength: number; fastest: number };
type Shrink = { split: ClipRegion[]; slots: Slot[] };

export const SPEEDUP_MAX = 1.25;
export const HOLD_FLOOR_MS = HOLD_KEEP_MS - WAIT_KEEP_TAIL_MS;

export const NO_CLIPS =
	"The timeline has no clips yet. Wait for the recording to finish loading, then try again.";

/** Ten minutes. Longer is a typo, and it would be rendered frame by frame. */
export const MAX_INSERT_MS = 600_000;

/** Back the held frame off the very end of the media, which decodes short. */
const FREEZE_END_MARGIN_MS = 50;

export function requireInsertMs(value: unknown, field: string): number {
	const ms = requireFiniteNumber(value, field);
	if (!Number.isInteger(ms) || ms <= 0 || ms > MAX_INSERT_MS) {
		throw new Error(
			`${field} must be a whole number of milliseconds from 1 to ${MAX_INSERT_MS}; it is new time added to the timeline.`,
		);
	}
	return ms;
}

/**
 * A held frame reads a one-millisecond source span, which the decoder resamples
 * into every output frame of the hold. The margin keeps that span clear of the
 * media's final frame interval, which decodes short and would starve the hold.
 */
export function freezeClip(
	context: EditorOpContext,
	clips: ClipRegion[],
	atMs: number,
	ms: number,
): ClipRegion {
	const sourceMs = mapTimelineTimeToSourceTime(atMs, clips);
	const holdEndMs = Math.max(
		FREEZE_SOURCE_MS,
		Math.min(sourceMs, Math.round(context.duration * 1000) - FREEZE_END_MARGIN_MS),
	);
	const holdStartMs = Math.max(0, holdEndMs - FREEZE_SOURCE_MS);
	const span = holdEndMs - holdStartMs;
	if (span <= 0) {
		throw new Error("This recording is too short to hold a frame from. Nothing was changed.");
	}
	return {
		id: nextId(context.ids.clip, "clip"),
		startMs: atMs,
		endMs: atMs + ms,
		sourceStartMs: holdStartMs,
		speed: span / ms,
		muted: true,
	};
}

/** Inserting time is a pure translation, so every later effect simply moves. */
export function applyTimelineInsert(
	context: EditorOpContext,
	base: ClipRegion[],
	atMs: number,
	inserted: ClipRegion,
) {
	const { timeline } = context;
	const ms = inserted.endMs - inserted.startMs;
	const next = insertClipRegion(base, atMs, inserted);
	timeline.setClipRegions(next);
	timeline.setZoomRegions((current) => shiftRegionsForInsert(current, atMs, ms));
	timeline.setAnnotationRegions((current) => shiftRegionsForInsert(current, atMs, ms));
	timeline.setAudioRegions((current) => shiftAnchorsForInsert(current, atMs, ms));
	timeline.setAutoCaptions((current) => shiftCaptionCuesForInsert(current, atMs, ms));
	return {
		changed: true,
		durationMs: getTimelineDurationMs(next, Math.round(context.duration * 1000)),
		clipCount: next.length,
	};
}

function loadClips(context: EditorOpContext) {
	const clips = sortClipRegions(context.timeline.clipRegions);
	if (clips.length === 0) throw new Error(NO_CLIPS);
	const sourceMs = Math.round(context.duration * 1000);
	return { clips, sourceMs, totalMs: getTimelineDurationMs(clips, sourceMs) };
}

function requireTimelineTime(value: unknown, field: string, totalMs: number): number {
	const time = Math.round(requireFiniteNumber(value, field));
	if (time < 0 || time > totalMs) {
		throw new Error(
			`${field} is ${time} ms, outside the edit. Times are timeline milliseconds, from 0 to ${totalMs}.`,
		);
	}
	return time;
}

function requireTimelineSpan(payload: Record<string, unknown>, totalMs: number): Range {
	const startMs = requireTimelineTime(payload.startMs, "startMs", totalMs);
	const endMs = requireTimelineTime(payload.endMs, "endMs", totalMs);
	if (endMs <= startMs) {
		throw new Error(
			`endMs (${endMs}) must be after startMs (${startMs}). Times are timeline milliseconds.`,
		);
	}
	return { startMs, endMs };
}

function requireIndex(value: unknown, field: string, length: number): number {
	const index = requireFiniteNumber(value, field);
	if (!Number.isInteger(index) || index < 0 || index >= length) {
		throw new Error(
			`${field} must be a whole number from 0 to ${length - 1}, in timeline order; the edit has ${length} clip${length === 1 ? "" : "s"}.`,
		);
	}
	return index;
}

function clipIndexFor(payload: Record<string, unknown>, clips: ClipRegion[], op: string) {
	if (payload.clipIndex === undefined) {
		if (clips.length > 1) {
			throw new Error(
				`${op} needs clipIndex because the edit has ${clips.length} clips, numbered from 0 in timeline order.`,
			);
		}
		return 0;
	}
	return requireIndex(payload.clipIndex, "clipIndex", clips.length);
}

function idFactory(context: EditorOpContext) {
	return () => nextId(context.ids.clip, "clip");
}

function splitAt(clips: ClipRegion[], timeMs: number, createId: () => string): ClipRegion[] {
	const plan = planClipSplit({ clipRegions: clips, splitMs: timeMs, createId });
	if (!plan) return clips;
	return clips.flatMap((clip) => (clip.id === plan.targetId ? [plan.left, plan.right] : [clip]));
}

function applySequence(context: EditorOpContext, before: ClipRegion[], edited: ClipRegion[]) {
	const { timeline } = context;
	const next = packClipSequence(edited);
	timeline.setClipRegions(next);
	timeline.setZoomRegions((current) => rippleRegions(current, before, next));
	timeline.setAnnotationRegions((current) => rippleRegions(current, before, next));
	timeline.setAudioRegions((current) => rippleRegionAnchors(current, before, next));
	if (timeline.selectedClipId && !next.some((clip) => clip.id === timeline.selectedClipId)) {
		timeline.setSelectedClipId(null);
	}
	return {
		changed: true,
		durationMs: getTimelineDurationMs(next, Math.round(context.duration * 1000)),
		clipCount: next.length,
	};
}

function unchanged(totalMs: number, reason: string) {
	return { changed: false, durationMs: totalMs, note: reason };
}

function safeSpeed(clip: ClipRegion) {
	return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

function retime(clip: ClipRegion, speed: number): ClipRegion {
	return {
		...clip,
		sourceStartMs: getClipSourceStartMs(clip),
		speed,
		endMs:
			clip.startMs +
			Math.max(1, Math.round(((clip.endMs - clip.startMs) * safeSpeed(clip)) / speed)),
	};
}

function subtract(ranges: Range[], cut: Range): Range[] {
	return ranges.flatMap((range) => {
		if (cut.endMs <= range.startMs || cut.startMs >= range.endMs) return [range];
		const pieces: Range[] = [];
		if (cut.startMs > range.startMs) pieces.push({ ...range, endMs: cut.startMs });
		if (cut.endMs < range.endMs) pieces.push({ ...range, startMs: cut.endMs });
		return pieces;
	});
}

function activitySpans(log: AgentActivityLog): AgentActivitySpan[] {
	return log.spans
		.filter((span) => Number.isFinite(span.startMs) && Number.isFinite(span.endMs))
		.sort((a, b) => a.startMs - b.startMs);
}

function actionRanges(log: AgentActivityLog, spans: AgentActivitySpan[]): Range[] {
	return [
		...spans
			.filter((span) => span.kind === "motion")
			.map((span) => ({
				startMs: span.startMs - MOTION_LEAD_MS,
				endMs: span.endMs + MOTION_TAIL_MS,
			})),
		...(log.changeTimesMs ?? [])
			.filter(Number.isFinite)
			.map((time) => ({ startMs: time - QUIET_RADIUS_MS, endMs: time + QUIET_RADIUS_MS })),
	];
}

function keepOutsideAction(ranges: Range[], action: Range[], minMs: number): Range[] {
	return action
		.reduce((current, cut) => subtract(current, cut), ranges)
		.filter((range) => range.endMs - range.startMs >= minMs)
		.map(({ startMs, endMs }) => ({ startMs: Math.round(startMs), endMs: Math.round(endMs) }));
}

export function findIdleRanges(log: AgentActivityLog, sourceMs: number): Range[] {
	const spans = activitySpans(log);
	const interiors = spans.flatMap((span, index): Range[] =>
		span.kind === "motion"
			? []
			: [
					{
						startMs: Math.max(
							0,
							span.startMs + holdKeepMs(span, spans[index - 1]) - WAIT_KEEP_TAIL_MS,
						),
						endMs: Math.min(sourceMs, span.endMs - WAIT_KEEP_TAIL_MS),
					},
				],
	);
	return keepOutsideAction(interiors, actionRanges(log, spans), MIN_SHOT_MS);
}

export function findHoldSlackRanges(log: AgentActivityLog, sourceMs: number): Range[] {
	const spans = activitySpans(log);
	const heads = spans.flatMap((span, index): Range[] =>
		span.kind === "motion"
			? []
			: [
					{
						startMs: Math.max(0, span.startMs + HOLD_FLOOR_MS),
						endMs: Math.min(
							sourceMs,
							span.endMs,
							span.startMs + holdKeepMs(span, spans[index - 1]) - WAIT_KEEP_TAIL_MS,
						),
					},
				],
	);
	return keepOutsideAction(heads, actionRanges(log, spans), 1);
}

function clipsWithin(clips: ClipRegion[], range: Range): number {
	return Math.round(
		clips.reduce((sum, clip) => {
			const start = Math.max(getClipSourceStartMs(clip), range.startMs);
			const end = Math.min(getClipSourceEndMs(clip), range.endMs);
			return sum + Math.max(0, end - start) / safeSpeed(clip);
		}, 0),
	);
}

function rampLimit(clip: ClipRegion) {
	return Math.max(1, RAMP_MAX_SPEED / safeSpeed(clip));
}

function slotsFor(clips: ClipRegion[], limit: (clip: ClipRegion) => number): Slot[] {
	return clips.map((clip) => {
		const duration = clip.endMs - clip.startMs;
		const sourceLength = duration * safeSpeed(clip);
		return { clip, duration, sourceLength, fastest: duration / limit(clip) };
	});
}

function totalMsOf(slots: Slot[]) {
	return slots.reduce((sum, slot) => sum + slot.duration, 0);
}

function speedRoomOf(slots: Slot[]) {
	return slots.reduce((sum, slot) => sum + slot.duration - slot.fastest, 0);
}

function midWithin(clip: ClipRegion, ranges: Range[]) {
	const mid = (getClipSourceStartMs(clip) + getClipSourceEndMs(clip)) / 2;
	return ranges.some((range) => mid >= range.startMs && mid < range.endMs);
}

function splitAtRanges(clips: ClipRegion[], ranges: Range[], createId: () => string) {
	return ranges.reduce(
		(current, range) =>
			[range.startMs, range.endMs].reduce(
				(inner, time) => splitAt(inner, mapSourceTimeToTimelineTime(time, inner), createId),
				current,
			),
		clips,
	);
}

function reduceSlots(
	slots: Slot[],
	reduceMs: number,
	maxRate: number,
): Map<string, ClipRegion | null> {
	const capacityMs = totalMsOf(slots);
	const speedCapacity = speedRoomOf(slots);
	const fastestTotal = capacityMs - speedCapacity;
	const speedOnly = reduceMs <= speedCapacity;
	const durations = slots.map((slot) =>
		Math.round(
			speedOnly
				? slot.duration - (reduceMs * (slot.duration - slot.fastest)) / speedCapacity
				: slot.fastest * (1 - (reduceMs - speedCapacity) / fastestTotal),
		),
	);
	const residual = capacityMs - reduceMs - durations.reduce((sum, value) => sum + value, 0);
	const absorber = durations.findIndex(
		(value, index) => value + residual >= 0 && value + residual <= slots[index].duration,
	);
	if (residual !== 0 && absorber >= 0) durations[absorber] += residual;
	const replacements = new Map<string, ClipRegion | null>();
	slots.forEach((slot, index) => {
		const duration = durations[index];
		if (duration === slot.duration) return;
		if (duration <= 0) {
			replacements.set(slot.clip.id, null);
			return;
		}
		replacements.set(slot.clip.id, {
			...slot.clip,
			sourceStartMs: getClipSourceStartMs(slot.clip),
			speed: Math.min(
				maxRate,
				speedOnly
					? slot.sourceLength / duration
					: Math.max(safeSpeed(slot.clip), RAMP_MAX_SPEED),
			),
			endMs: slot.clip.startMs + duration,
		});
	});
	return replacements;
}

function commitReplacements(
	context: EditorOpContext,
	split: ClipRegion[],
	replacements: Map<string, ClipRegion | null>,
) {
	const edited = split.flatMap((clip) => {
		const replacement = replacements.get(clip.id);
		return replacement === undefined ? [clip] : replacement ? [replacement] : [];
	});
	return applySequence(context, split, edited);
}

function shorten(
	context: EditorOpContext,
	clips: ClipRegion[],
	log: AgentActivityLog,
	sourceMs: number,
	reduceMs: number,
	label: string,
	bounds?: Range,
) {
	const createId = idFactory(context);
	const maxRate = getPreviewPlaybackRateRange().max;
	const mildLimit = (clip: ClipRegion) =>
		Math.max(1, Math.min(SPEEDUP_MAX, maxRate / safeSpeed(clip)));
	const within = (ranges: Range[], minMs: number) =>
		bounds ? clampRanges(ranges, bounds, minMs) : ranges;
	const plan = (cuts: Range[], slack: Range[]): Shrink => {
		const split = splitAtRanges(clips, cuts, createId);
		return {
			split,
			slots: slotsFor(
				split.filter((clip) => midWithin(clip, slack)),
				rampLimit,
			),
		};
	};
	const idle = within(findIdleRanges(log, sourceMs), MIN_SHOT_MS);
	const idleOnly = plan(idle, idle);
	if (reduceMs <= totalMsOf(idleOnly.slots)) {
		return {
			...commitReplacements(
				context,
				idleOnly.split,
				reduceSlots(idleOnly.slots, reduceMs, maxRate),
			),
			idleStretches: idleOnly.slots.length,
			levers: ["idle"],
		};
	}
	const slack = [...idle, ...within(findHoldSlackRanges(log, sourceMs), 1)];
	const withHolds = plan(slack, slack);
	if (reduceMs <= totalMsOf(withHolds.slots)) {
		return {
			...commitReplacements(
				context,
				withHolds.split,
				reduceSlots(withHolds.slots, reduceMs, maxRate),
			),
			idleStretches: withHolds.slots.length,
			levers: ["idle", "holds"],
		};
	}
	const rated = plan(bounds ? [...slack, bounds] : slack, slack);
	const slackMs = totalMsOf(rated.slots);
	const rateSlots = slotsFor(
		rated.split.filter(
			(clip) => !midWithin(clip, slack) && (!bounds || midWithin(clip, [bounds])),
		),
		mildLimit,
	);
	const residualMs = reduceMs - slackMs;
	const room = speedRoomOf(rateSlots);
	if (residualMs > room) {
		const maxMs = Math.round(slackMs + room);
		const shortMs = reduceMs - maxMs;
		throw new Error(
			`${label} cannot be reached without cutting into action: speeding up and trimming every idle stretch, shaving every end-of-scene hold to its ${HOLD_KEEP_MS} ms floor and running the kept footage at ${SPEEDUP_MAX}x together remove at most ${maxMs} ms, which is ${shortMs} ms short. Nothing was changed. Ask for ${shortMs} ms more, or cut action explicitly with timeline.remove. Times are timeline milliseconds.`,
		);
	}
	return {
		...commitReplacements(
			context,
			rated.split,
			new Map([
				...reduceSlots(rated.slots, slackMs, maxRate),
				...reduceSlots(rateSlots, residualMs, maxRate),
			]),
		),
		idleStretches: rated.slots.length,
		levers: ["idle", "holds", "speed"],
	};
}

function sceneAt(log: AgentActivityLog, index: unknown) {
	const scenes = [...log.scenes].sort((a, b) => a.startMs - b.startMs);
	if (scenes.length === 0) {
		throw new Error(
			"This recording's activity log has no scenes. Use timeline.fit to hit a total length, or timeline.speed for one clip.",
		);
	}
	const at = requireFiniteNumber(index, "index");
	if (!Number.isInteger(at) || at < 0 || at >= scenes.length) {
		throw new Error(
			`index must be a whole number from 0 to ${scenes.length - 1}; the recording has ${scenes.length} scene${scenes.length === 1 ? "" : "s"}.`,
		);
	}
	return scenes[at];
}

function clampRanges(ranges: Range[], bounds: Range, minMs: number): Range[] {
	return ranges.flatMap((range) => {
		const startMs = Math.max(range.startMs, bounds.startMs);
		const endMs = Math.min(range.endMs, bounds.endMs);
		return endMs - startMs >= minMs ? [{ startMs, endMs }] : [];
	});
}

export const timelineOps: EditorOpMap = {
	"timeline.trim": (payload, context) => {
		const args = requireObject(payload, "timeline.trim");
		const { clips, totalMs, sourceMs } = loadClips(context);
		const span = requireTimelineSpan(args, totalMs);
		if (args.clipIndex === undefined) {
			if (span.startMs === 0 && span.endMs === totalMs) {
				return unchanged(totalMs, "The edit already spans exactly that range.");
			}
			const createId = idFactory(context);
			const split = splitAt(splitAt(clips, span.startMs, createId), span.endMs, createId);
			const kept = split.filter(
				(clip) => clip.startMs >= span.startMs && clip.endMs <= span.endMs,
			);
			if (kept.length === 0) {
				throw new Error(
					`No footage lies between ${span.startMs} and ${span.endMs} ms (timeline milliseconds), so there is nothing to keep.`,
				);
			}
			return applySequence(context, split, kept);
		}
		const index = requireIndex(args.clipIndex, "clipIndex", clips.length);
		const clip = clips[index];
		if (span.startMs < clip.startMs || span.endMs > clip.endMs) {
			throw new Error(
				`Clip ${index} covers ${clip.startMs} to ${clip.endMs} ms (timeline milliseconds); the span to keep must lie inside it. Trimming only shortens a clip.`,
			);
		}
		if (span.startMs === clip.startMs && span.endMs === clip.endMs) {
			return unchanged(totalMs, `Clip ${index} already spans exactly that range.`);
		}
		const trimmed = changeClipSpan(clip, span.startMs, span.endMs, sourceMs);
		if (trimmed.endMs <= trimmed.startMs) {
			throw new Error(
				`Keeping ${span.startMs} to ${span.endMs} ms would leave clip ${index} empty.`,
			);
		}
		return applySequence(
			context,
			clips,
			clips.map((candidate) => (candidate.id === clip.id ? trimmed : candidate)),
		);
	},

	"timeline.split": (payload, context) => {
		const args = requireObject(payload, "timeline.split");
		const { clips, totalMs } = loadClips(context);
		const timeMs = requireTimelineTime(args.timeMs, "timeMs", totalMs);
		const split = splitAt(clips, timeMs, idFactory(context));
		if (split === clips) {
			throw new Error(
				`${timeMs} ms (timeline milliseconds) is already a clip boundary or lies outside every clip, so there is nothing to split.`,
			);
		}
		context.timeline.setClipRegions(split);
		const { selectedClipId } = context.timeline;
		if (selectedClipId && !split.some((clip) => clip.id === selectedClipId)) {
			context.timeline.setSelectedClipId(
				split.find((clip) => clip.endMs === timeMs)?.id ?? null,
			);
		}
		return { changed: true, durationMs: totalMs, clipCount: split.length };
	},

	"timeline.remove": (payload, context) => {
		const args = requireObject(payload, "timeline.remove");
		const { clips, totalMs } = loadClips(context);
		const span = requireTimelineSpan(args, totalMs);
		const createId = idFactory(context);
		const split = splitAt(splitAt(clips, span.startMs, createId), span.endMs, createId);
		const kept = split.filter(
			(clip) => !(clip.startMs >= span.startMs && clip.endMs <= span.endMs),
		);
		if (kept.length === split.length) {
			throw new Error(
				`No footage lies between ${span.startMs} and ${span.endMs} ms (timeline milliseconds), so nothing was removed.`,
			);
		}
		if (kept.length === 0) {
			throw new Error(
				"That would remove the whole recording. Keep at least one clip, or use timeline.trim to choose what stays.",
			);
		}
		return applySequence(context, split, kept);
	},

	"timeline.speed": (payload, context) => {
		const args = requireObject(payload, "timeline.speed");
		const { clips, totalMs } = loadClips(context);
		const speed = requireFiniteNumber(args.speed, "speed");
		if (!supportsPreviewPlaybackRate(speed)) {
			const { min, max } = getPreviewPlaybackRateRange();
			throw new Error(
				`speed ${speed} is a rate this device cannot play. Use a speed from ${min} to ${max}; 1 restores normal speed.`,
			);
		}
		const index = clipIndexFor(args, clips, "timeline.speed");
		const clip = clips[index];
		if (safeSpeed(clip) === speed) {
			return unchanged(totalMs, `Clip ${index} already plays at ${speed}x.`);
		}
		return applySequence(
			context,
			clips,
			clips.map((candidate) =>
				candidate.id === clip.id ? retime(candidate, speed) : candidate,
			),
		);
	},

	"timeline.reorder": (payload, context) => {
		const args = requireObject(payload, "timeline.reorder");
		const { clips, totalMs } = loadClips(context);
		if (clips.length < 2) {
			throw new Error("The edit has a single clip, so there is nothing to reorder.");
		}
		const from = requireIndex(args.fromIndex, "fromIndex", clips.length);
		const to = requireIndex(args.toIndex, "toIndex", clips.length);
		if (from === to) {
			return unchanged(totalMs, `Clip ${from} is already at position ${to}.`);
		}
		return applySequence(context, clips, reorderClipSequence(clips, clips[from].id, to));
	},

	"timeline.set_scene_duration": async (payload, context) => {
		const args = requireObject(payload, "timeline.set_scene_duration");
		const { clips, totalMs } = loadClips(context);
		const ms = Math.round(requireFiniteNumber(args.ms, "ms"));
		if (ms <= 0) throw new Error("ms must be more than 0. Times are timeline milliseconds.");
		const log = await loadAgentActivity(
			context.videoSourcePath,
			"Use timeline.speed or timeline.remove with explicit times instead of timeline.set_scene_duration.",
		);
		const scene = sceneAt(log, args.index);
		const currentMs = clipsWithin(clips, scene);
		if (currentMs === 0) {
			throw new Error(
				`Scene ${args.index} has been cut out of the edit, so it has no length to change.`,
			);
		}
		if (ms === currentMs)
			return unchanged(totalMs, `Scene ${args.index} already lasts ${ms} ms.`);
		if (ms > currentMs) {
			throw new Error(
				`Scene ${args.index} lasts ${currentMs} ms and can only be shortened to ${ms} ms, not lengthened. Use timeline.speed to slow a clip down.`,
			);
		}
		return {
			...shorten(
				context,
				clips,
				log,
				Math.round(context.duration * 1000),
				currentMs - ms,
				`A ${ms} ms scene`,
				scene,
			),
			sceneMs: ms,
		};
	},

	"timeline.freeze": (payload, context) => {
		const args = requireObject(payload, "timeline.freeze");
		rejectUnknown(args, ["atMs", "ms"], "timeline.freeze");
		const { clips, totalMs } = loadClips(context);
		const atMs = requireTimelineTime(args.atMs, "atMs", totalMs);
		const ms = requireInsertMs(args.ms, "ms");
		const held = freezeClip(context, clips, atMs, ms);
		const split = splitAt(clips, atMs, idFactory(context));
		return {
			...applyTimelineInsert(context, split, atMs, held),
			frozenSourceMs: getClipSourceStartMs(held),
			holdMs: ms,
		};
	},

	"timeline.fit": async (payload, context) => {
		const args = requireObject(payload, "timeline.fit");
		const { clips, totalMs, sourceMs } = loadClips(context);
		const targetMs = Math.round(requireFiniteNumber(args.targetMs, "targetMs"));
		if (targetMs <= 0)
			throw new Error("targetMs must be more than 0. Times are timeline milliseconds.");
		if (targetMs === totalMs)
			return unchanged(totalMs, `The edit already lasts ${targetMs} ms.`);
		if (targetMs > totalMs) {
			throw new Error(
				`The edit lasts ${totalMs} ms, shorter than targetMs (${targetMs}). fit only shortens; use timeline.speed to slow clips down.`,
			);
		}
		const log = await loadAgentActivity(
			context.videoSourcePath,
			"Use timeline.speed or timeline.remove with explicit times instead of timeline.fit.",
		);
		return {
			...shorten(context, clips, log, sourceMs, totalMs - targetMs, `${targetMs} ms`),
			targetMs,
		};
	},
	"timeline.join": async (payload, context) => {
		const args = requireObject(payload, "timeline.join");
		rejectUnknown(args, ["path", "index"], "timeline.join");
		const { path } = args;
		if (typeof path !== "string" || !path.trim()) {
			throw new Error("timeline.join: path must be the absolute path of a recording to add.");
		}
		const current = context.videoSourcePath;
		if (!current) throw new Error("timeline.join: there is no recording loaded to join onto.");
		if (path === current) {
			throw new Error("timeline.join: that is the recording already loaded.");
		}
		const { clips } = loadClips(context);
		const index =
			args.index === undefined
				? clips.length
				: requireIndex(args.index, "index", clips.length + 1);
		const importRecording = window.electronAPI?.importRecording;
		const finishRecordingImport = window.electronAPI?.finishRecordingImport;
		if (!importRecording || !finishRecordingImport) {
			throw new Error("timeline.join: joining recordings is unavailable here.");
		}
		const imported = await importRecording(current, path);
		if (!imported.success) {
			throw new Error(
				`timeline.join: ${imported.error ?? "the recording could not be added."}`,
			);
		}
		const media = imported.value;
		let accepted = false;
		try {
			context.assertSameRecording();
			const prepared = await finishRecordingImport(media.path);
			if (!prepared.success) {
				throw new Error(
					`timeline.join: ${prepared.error ?? "the added media could not be finalized."}`,
				);
			}
			context.assertSameRecording();
			const committed = await finishRecordingImport(media.path, true);
			if (!committed.success) {
				throw new Error(
					`timeline.join: ${committed.error ?? "the added media could not be kept."}`,
				);
			}
			accepted = true;
		} finally {
			if (!accepted) {
				await finishRecordingImport(media.path, false).catch(() => undefined);
			}
		}
		const latest = sortClipRegions(context.timeline.clipRegions);
		const at = Math.min(index, latest.length);
		const joined = appendImportedClip(latest, media, nextId(context.ids.clip, "clip"), at);
		const applied = applySequence(context, latest, joined);
		context.adoptJoinedMedia({ path: media.path, url: media.url });
		return {
			...applied,
			joined: { path, durationMs: media.durationMs, sourcePath: media.path },
		};
	},
};
