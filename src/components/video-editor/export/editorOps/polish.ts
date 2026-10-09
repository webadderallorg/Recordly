import {
	CAPTION_MAX_CHARS,
	MIN_TOTAL_CUT_MS,
	RAMP_MAX_SPEED,
} from "../../agentEdits/planAgentEdits";
import { getTimelineDurationMs } from "../../types";
import { getPreviewPlaybackRateRange } from "../../videoPlayback/playbackRate";
import { captionsOps } from "./captions";
import { type EditProblem, lintEdits } from "./checkEdits";
import { lookOps } from "./look";
import { findIdleRanges, timelineOps } from "./timeline";
import {
	type EditorOpContext,
	type EditorOpMap,
	loadAgentActivity,
	rejectUnknown,
	requireObject,
} from "./types";

export const POLISH_STYLES = ["clean", "dark", "none"] as const;
type PolishStyle = (typeof POLISH_STYLES)[number];

type StepStatus = "applied" | "checked" | "already_present" | "skipped" | "failed";
type Step = { step: string; status: StepStatus; detail: string };

export const POLISH_UNDO_NOTE =
	"history.undo reverts only the timeline edits (speed-ups, captions); it does NOT revert the look, which is not in the editor history. To go back, call set_look or look.preset with the previous values from get_editor_state, and undo the timeline edits one history.undo at a time.";

function lookSnapshot(context: EditorOpContext) {
	return context.appearance as unknown as Record<string, unknown>;
}

function message(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

async function attempt(
	steps: Step[],
	step: string,
	work: () => Promise<Omit<Step, "step">> | Omit<Step, "step">,
) {
	try {
		steps.push({ step, ...(await work()) });
	} catch (error) {
		steps.push({ step, status: "failed", detail: message(error) });
	}
}

function automaticEditSummary(context: EditorOpContext): Step {
	const { clipRegions, zoomRegions, autoCaptions } = context.timeline;
	const cuts = clipRegions.length > 1 || clipRegions.some((c) => c.speed !== 1);
	const found = [
		cuts ? `${clipRegions.length} clips` : null,
		zoomRegions.length > 0 ? `${zoomRegions.length} zooms` : null,
		autoCaptions.length > 0 ? `${autoCaptions.length} captions` : null,
	].filter(Boolean);
	return found.length > 0
		? {
				step: "cuts_and_zooms",
				status: "already_present",
				detail: `Left as they are: ${found.join(", ")} are already in the edit (the automatic edit on load, or earlier calls). Zooms are never added here.`,
			}
		: {
				step: "cuts_and_zooms",
				status: "skipped",
				detail: "The edit has no cuts, zooms or captions yet. This tool does not add zooms; use zoom.add, or reopen the fresh recording to get the automatic edit.",
			};
}

function isUntouched(context: EditorOpContext) {
	const { clipRegions, zoomRegions, speedRegions } = context.timeline;
	return (
		zoomRegions.length === 0 &&
		(speedRegions?.length ?? 0) === 0 &&
		clipRegions.length <= 1 &&
		clipRegions.every(
			(clip) => clip.startMs === 0 && (clip.sourceStartMs ?? 0) === 0 && clip.speed === 1,
		)
	);
}

async function idleSpeedup(context: EditorOpContext): Promise<Omit<Step, "step">> {
	if (!isUntouched(context)) {
		return {
			status: "already_present",
			detail: "The timeline is already cut or sped up, so idle stretches were not touched again.",
		};
	}
	const log = await loadAgentActivity(
		context.videoSourcePath,
		"Idle stretches can only be found for a recording an agent drove.",
	).catch((error) => {
		throw new Error(`Idle speed-up skipped: ${message(error)}`);
	});
	const sourceMs = Math.round(context.duration * 1000);
	const idleMs = findIdleRanges(log, sourceMs).reduce(
		(sum, range) => sum + range.endMs - range.startMs,
		0,
	);
	const rate = Math.min(RAMP_MAX_SPEED, getPreviewPlaybackRateRange().max);
	const reduceMs = Math.floor(idleMs * (1 - 1 / rate) * 0.98);
	if (reduceMs < MIN_TOTAL_CUT_MS) {
		return {
			status: "skipped",
			detail: "There is no idle stretch long enough to be worth speeding up.",
		};
	}
	const totalMs = getTimelineDurationMs(context.timeline.clipRegions, sourceMs);
	const result = (await timelineOps["timeline.fit"](
		{ targetMs: totalMs - reduceMs },
		context,
	)) as { durationMs: number };
	return {
		status: "applied",
		detail: `Idle stretches run at up to ${rate}x: ${totalMs} ms became ${result.durationMs} ms. The speed changes are hard steps, not ramps. Undoable with history.undo.`,
	};
}

async function captionStep(
	context: EditorOpContext,
	captions: boolean | undefined,
): Promise<Omit<Step, "step">> {
	if (captions === false)
		return { status: "skipped", detail: "Captions were not requested (captions: false)." };
	if (captions === undefined && context.timeline.autoCaptions.length > 0) {
		return {
			status: "already_present",
			detail: `${context.timeline.autoCaptions.length} captions are already there and were kept. Pass captions: true to replace them with the scene titles.`,
		};
	}
	const log = await loadAgentActivity(
		context.videoSourcePath,
		"Captions are fitted to the scenes of a recording an agent drove; use edit_captions with explicit times instead.",
	);
	const scenes = log.scenes
		.filter((scene) => !scene.failed)
		.sort((a, b) => a.startMs - b.startMs);
	if (scenes.length === 0) {
		return {
			status: "skipped",
			detail:
				log.scenes.length === 0
					? "The recording has no scenes, so there is nothing to caption."
					: "Every scene failed and is cut from the export, so there is nothing to caption.",
		};
	}
	const untitled = scenes.filter((scene) => !scene.title?.trim()).length;
	if (untitled > 0) {
		return {
			status: "skipped",
			detail: `${untitled} of ${scenes.length} scenes have no title, and captions are made from scene titles. Name the scenes, or use edit_captions.`,
		};
	}
	const texts = scenes.map((scene) =>
		Array.from((scene.title as string).trim())
			.slice(0, CAPTION_MAX_CHARS)
			.join(""),
	);
	const result = (await captionsOps["captions.fit_to_scenes"]({ texts }, context)) as {
		count: number;
		skipped: { scene: number }[];
	};
	const left = result.skipped.length;
	return {
		status: "applied",
		detail: `${result.count} captions from the scene titles${left > 0 ? `; scenes ${result.skipped.map((s) => s.scene).join(", ")} had no room and got none` : ""}. Undoable with history.undo.`,
	};
}

function lookStep(context: EditorOpContext, style: PolishStyle) {
	const before = JSON.stringify(
		Object.fromEntries(
			["padding", "borderRadius", "shadowIntensity", "backgroundBlur", "wallpaper"].map(
				(k) => [k, lookSnapshot(context)[k]],
			),
		),
	);
	const { applied } = lookOps["look.preset"]({ name: style }, context) as {
		applied: Record<string, unknown>;
	};
	const same = Object.entries(applied).every(
		([key, value]) => JSON.stringify(value) === JSON.stringify(JSON.parse(before)[key]),
	);
	return {
		applied,
		step: {
			status: same ? "already_present" : "applied",
			detail: same
				? `The "${style}" look was already set.`
				: `Set the "${style}" look (${Object.keys(applied).join(", ")}). Not undoable with history.undo.`,
		} as Omit<Step, "step">,
	};
}

export const polishOps: EditorOpMap = {
	polish_recording: async (payload, context) => {
		const args = requireObject(payload ?? {}, "polish_recording");
		rejectUnknown(args, ["style", "captions"], "polish_recording");
		if (args.style !== undefined && !POLISH_STYLES.includes(args.style as PolishStyle)) {
			throw new Error(
				`style must be one of ${POLISH_STYLES.join(", ")}, not ${String(args.style)}. Nothing was changed.`,
			);
		}
		if (args.captions !== undefined && typeof args.captions !== "boolean") {
			throw new Error("captions must be true or false. Nothing was changed.");
		}
		const style = (args.style ?? "clean") as PolishStyle;
		const captions = args.captions as boolean | undefined;
		if (!context.videoSourcePath) {
			throw new Error("There is no recording loaded to polish. Nothing was changed.");
		}
		const sourceMs = Math.round(context.duration * 1000);
		if (
			context.timeline.clipRegions.length === 0 ||
			getTimelineDurationMs(context.timeline.clipRegions, sourceMs) <= 0
		) {
			throw new Error(
				"The timeline is empty or has no length yet, so there is nothing to polish. Nothing was changed.",
			);
		}

		const steps: Step[] = [automaticEditSummary(context)];
		await attempt(steps, "idle_speedup", () => idleSpeedup(context));
		await attempt(steps, "captions", () => captionStep(context, captions));
		let lookApplied: Record<string, unknown> = {};
		await attempt(steps, "look", () => {
			const look = lookStep(context, style);
			lookApplied = look.applied;
			return look.step;
		});

		let problems: EditProblem[] = [];
		await attempt(steps, "check", () => {
			const checked = lintEdits({
				...context,
				appearance: { ...context.appearance, ...lookApplied },
			});
			problems = checked.problems;
			return {
				status: "checked",
				detail: `${problems.length} problems found, using the look just set; timeline changes from this call are not reflected, so call check_edits for a final check.`,
			};
		});

		const failed = steps.filter((s) => s.status === "failed");
		return {
			ok: failed.length === 0,
			steps,
			problems,
			rolledBack: false,
			note:
				failed.length > 0
					? `${failed.map((s) => s.step).join(", ")} failed; the other steps were applied and are NOT rolled back, because the look cannot be undone and a partial undo could remove an earlier edit of yours. ${POLISH_UNDO_NOTE}`
					: POLISH_UNDO_NOTE,
		};
	},
};
