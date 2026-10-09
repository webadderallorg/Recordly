import { CAPTION_DURATION_MS, CAPTION_MAX_CHARS } from "../../agentEdits/planAgentEdits";
import { normalizeCaptionEditText } from "../../captionEditing";
import { addCue, createCaptionCue, deleteCue, retimeCue } from "../../captionOps";
import { captionSpanToSource, projectCaptionCues } from "../../captionTimeline";
import {
	type AutoCaptionAnimation,
	type AutoCaptionSettings,
	type CaptionCue,
	type ClipRegion,
	findClipAtTimelineTime,
	getClipSourceEndMs,
	getClipSourceStartMs,
	getTimelineDurationMs,
	sortClipRegions,
} from "../../types";
import { midpointMs, requirePreviewFlag, withPreview } from "./previewAfterEdit";
import {
	type EditorOpContext,
	type EditorOpMap,
	loadAgentActivity,
	rejectUnknown,
	requireFiniteNumber,
	requireObject,
} from "./types";

const ANIMATIONS: AutoCaptionAnimation[] = ["none", "fade", "rise", "pop"];
const SOURCES = ["audio", "scenes"];
const DEFAULT_WHISPER_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_WHISPER_TIMEOUT_MS = 1000;
const MAX_WHISPER_TIMEOUT_MS = 30 * 60 * 1000;
const SCENE_LOOKUP_TIMEOUT_MS = 10 * 1000;
const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NUMBER_STYLES: Record<string, [number, number, boolean]> = {
	fontSize: [16, 72, false],
	bottomOffset: [0, 30, false],
	maxWidth: [40, 95, false],
	maxRows: [1, 4, true],
	boxRadius: [0, 40, false],
	backgroundOpacity: [0, 1, false],
};
const DEFAULT_PAD_MS = 200;
const MAX_PAD_MS = 2000;
const MIN_CUE_MS = 500;
const MAX_FIT_TEXTS = 500;
const COLOR_STYLES = ["textColor", "inactiveTextColor"];

let generation: { source: string; startedAt: number } | null = null;

function timelineMsOf(context: EditorOpContext) {
	return getTimelineDurationMs(context.timeline.clipRegions, Math.round(context.duration * 1000));
}

function requireText(value: unknown, field: string) {
	if (typeof value !== "string") throw new Error(`${field} must be text.`);
	const text = normalizeCaptionEditText(value);
	if (!text) throw new Error(`${field} must not be empty.`);
	return text;
}

export function toSourceSpan(
	startMs: number,
	endMs: number,
	context: EditorOpContext,
	field: string,
) {
	const timelineMs = timelineMsOf(context);
	if (startMs < 0 || endMs <= startMs) {
		throw new Error(`${field} must have startMs of 0 or more and an endMs after it.`);
	}
	if (endMs > timelineMs) {
		throw new Error(
			`${field} ends at ${endMs} ms, past the end of the recording at ${timelineMs} ms.`,
		);
	}
	const clips = context.timeline.clipRegions;
	if (clips.length === 0) return { startMs, endMs };
	const clip = findClipAtTimelineTime(startMs, clips);
	if (!clip) throw new Error(`${field} starts at ${startMs} ms, which is inside a cut.`);
	let last = clip;
	while (endMs > last.endMs) {
		const next = findClipAtTimelineTime(last.endMs, clips);
		const continues =
			next &&
			next.speed === clip.speed &&
			Math.abs(getClipSourceStartMs(next) - getClipSourceEndMs(last)) <= 1;
		if (!next || !continues) {
			throw new Error(
				`${field} crosses a cut at ${last.endMs} ms. Split it into one per shot.`,
			);
		}
		last = next;
	}
	return captionSpanToSource({ ...clip, endMs: last.endMs }, { start: startMs, end: endMs });
}

function rejectOverlap(cues: CaptionCue[], what: string, onlyId?: string) {
	const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
	for (let index = 1; index < sorted.length; index += 1) {
		const involvesId =
			onlyId === undefined || sorted[index].id === onlyId || sorted[index - 1].id === onlyId;
		if (involvesId && sorted[index].startMs < sorted[index - 1].endMs) {
			throw new Error(
				`${what} would overlap: "${sorted[index - 1].text}" and "${sorted[index].text}" share time. Captions are one at a time.`,
			);
		}
	}
}

function apply(context: EditorOpContext, cues: CaptionCue[]) {
	context.assertSameRecording();
	context.timeline.setAutoCaptions(cues);
	if (cues.length > 0) {
		context.timeline.setAutoCaptionSettings((current) => ({ ...current, enabled: true }));
	}
}

function withTimeout<T>(work: Promise<T>, ms: number, waitingFor: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						`Timed out after ${Math.round(ms / 1000)} s waiting for ${waitingFor}.`,
					),
				),
			ms,
		);
	});
	return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

function requireSource(context: EditorOpContext) {
	if (!context.videoSourcePath) throw new Error("There is no recording loaded to caption.");
	return context.videoSourcePath;
}

async function cuesFromScenes(context: EditorOpContext): Promise<CaptionCue[]> {
	const source = requireSource(context);
	const result = await withTimeout(
		Promise.resolve(window.electronAPI.getAgentActivity(source)),
		SCENE_LOOKUP_TIMEOUT_MS,
		"the scene list for this recording",
	);
	if (!result.success || !result.log) {
		throw new Error(
			result.error ??
				"This recording has no scene list. Scenes are written by an agent before a take, so captions from scenes only work on agent recordings.",
		);
	}
	const sourceMs = Math.round(context.duration * 1000);
	const all = result.log.scenes;
	if (all.length === 0) {
		throw new Error(
			"This recording's activity log has no scenes. Scenes are logged when an agent drives a take with perform.",
		);
	}
	const titled = all.filter((scene) => typeof scene.title === "string" && scene.title.trim());
	if (titled.length === 0) {
		throw new Error(
			`The scene list has ${all.length} scenes but none has a title. Pass scenes to start_recording, or a title on each perform, when recording; or write the captions with captions.set.`,
		);
	}
	const scenes = titled
		.filter((scene) => !scene.failed)
		.filter((scene) => scene.startMs >= 0 && scene.startMs < sourceMs)
		.sort((a, b) => a.startMs - b.startMs);
	const cues = scenes
		.map((scene, index) => {
			const next = scenes[index + 1];
			const endMs = Math.min(
				scene.endMs,
				sourceMs,
				next ? next.startMs : Number.POSITIVE_INFINITY,
				scene.startMs + CAPTION_DURATION_MS,
			);
			return { scene, endMs };
		})
		.filter(({ scene, endMs }) => endMs > scene.startMs)
		.map(({ scene, endMs }) =>
			createCaptionCue({
				startMs: scene.startMs,
				endMs,
				text: Array.from((scene.title ?? "").trim())
					.slice(0, CAPTION_MAX_CHARS)
					.join("")
					.trim(),
			}),
		);
	if (cues.length === 0) {
		throw new Error(
			`The scene list has ${titled.length} titled scenes but none can be captioned: each one failed (cut from the export) or lies outside the kept footage.`,
		);
	}
	rejectOverlap(cues, "The scene captions");
	return cues;
}

async function cuesFromAudio(context: EditorOpContext, timeoutMs: number): Promise<CaptionCue[]> {
	const source = requireSource(context);
	const model = await withTimeout(
		Promise.resolve(window.electronAPI.getWhisperSmallModelStatus()),
		SCENE_LOOKUP_TIMEOUT_MS,
		"the speech model status",
	);
	if (!model.success || !model.exists || !model.path) {
		throw new Error(
			"No speech model is downloaded. Open Captions in the editor and download the Whisper small model first.",
		);
	}
	const result = await withTimeout(
		Promise.resolve(
			window.electronAPI.generateAutoCaptions({
				videoPath: source,
				whisperModelPath: model.path,
				language: context.timeline.autoCaptionSettings.language,
			}),
		),
		timeoutMs,
		"speech recognition to finish (it may still be running in the background; nothing was changed)",
	);
	if (!result.success || !result.cues) {
		throw new Error(result.error ?? result.message ?? "Speech recognition failed.");
	}
	if (result.cues.length === 0) {
		throw new Error("Speech recognition found no speech in this recording.");
	}
	return result.cues;
}

type SceneSlot = { index: number; title: string | null; startMs: number; endMs: number };

function planSceneSpan(
	scene: SceneSlot,
	context: EditorOpContext,
	padMs: number,
	notBefore: number,
) {
	const sourceMs = Math.round(context.duration * 1000);
	const clips = context.timeline.clipRegions.length
		? sortClipRegions(context.timeline.clipRegions)
		: [{ id: "all", startMs: 0, endMs: sourceMs, speed: 1 } as ClipRegion];
	let best: { startMs: number; endMs: number } | null = null;
	for (const clip of clips) {
		const clipStart = getClipSourceStartMs(clip);
		const clipEnd = getClipSourceEndMs(clip);
		const from = Math.max(scene.startMs, clipStart);
		const to = Math.min(scene.endMs, clipEnd);
		if (to <= from) continue;
		const speed = clip.speed > 0 ? clip.speed : 1;
		const start = Math.max(Math.ceil(clip.startMs + (from - clipStart) / speed), notBefore);
		const end = Math.floor(clip.startMs + (to - clipStart) / speed);
		const room = end - start;
		if (room < MIN_CUE_MS) continue;
		const pad = Math.min(padMs, Math.floor((room - MIN_CUE_MS) / 2));
		const span = { startMs: start + pad, endMs: end - pad };
		if (!best || span.endMs - span.startMs > best.endMs - best.startMs) best = span;
	}
	return best;
}

function captionsEdited(cues: CaptionCue[], context: EditorOpContext) {
	return {
		timeline: {
			autoCaptions: cues,
			autoCaptionSettings: { ...context.timeline.autoCaptionSettings, enabled: true },
		},
	};
}

function captionMoment(cue: CaptionCue, context: EditorOpContext, which: string) {
	const clips = context.timeline.clipRegions;
	const span = clips.length === 0 ? cue : projectCaptionCues([cue], clips)[0];
	if (!span) {
		throw new Error(
			`${which} sits entirely inside a cut, so it never plays and there is nothing to show`,
		);
	}
	return {
		atMs: midpointMs(span.startMs, span.endMs, context),
		why: `Shown at the middle of ${which} (cue times are recording time, this is its place on the edited timeline).`,
	};
}

export const captionsOps: EditorOpMap = {
	"captions.fit_to_scenes": async (payload, context) => {
		const args = requireObject(payload, "captions.fit_to_scenes");
		rejectUnknown(args, ["texts", "padMs", "preview"], "captions.fit_to_scenes");
		const preview = requirePreviewFlag(args.preview);
		if (!Array.isArray(args.texts) || args.texts.length === 0) {
			throw new Error("texts must be a non-empty list with one caption per scene.");
		}
		if (args.texts.length > MAX_FIT_TEXTS) {
			throw new Error(
				`texts has ${args.texts.length} entries; the most allowed is ${MAX_FIT_TEXTS}.`,
			);
		}
		const texts = args.texts.map((raw, index) => {
			const text = requireText(raw, `texts[${index}]`);
			if (Array.from(text).length > CAPTION_MAX_CHARS) {
				throw new Error(`texts[${index}] is longer than ${CAPTION_MAX_CHARS} characters.`);
			}
			return text;
		});
		let padMs = DEFAULT_PAD_MS;
		if (args.padMs !== undefined) {
			padMs = requireFiniteNumber(args.padMs, "padMs");
			if (padMs < 0 || padMs > MAX_PAD_MS) {
				throw new Error(`padMs must be between 0 and ${MAX_PAD_MS}.`);
			}
		}
		const log = await loadAgentActivity(
			context.videoSourcePath,
			"Captions can only be fitted to scenes of a recording an agent drove; use captions.set with explicit times instead.",
		);
		const all = log.scenes
			.slice()
			.sort((a, b) => a.startMs - b.startMs)
			.map((scene, index) => ({
				index,
				failed: scene.failed,
				title: scene.title ?? null,
				startMs: scene.startMs,
				endMs: scene.endMs,
			}));
		const scenes = all.filter((scene) => !scene.failed);
		if (scenes.length === 0) {
			throw new Error(
				all.length === 0
					? "This recording has no scenes to fit captions to."
					: `All ${all.length} scenes failed and are cut from the export, so there is nothing to caption.`,
			);
		}
		if (texts.length !== scenes.length) {
			throw new Error(
				`texts has ${texts.length} entries but the recording has ${scenes.length} scenes to caption (${all.length - scenes.length} failed scenes are excluded). Give exactly one text per scene, in scene order.`,
			);
		}
		const built: CaptionCue[] = [];
		const skipped: { scene: number; title: string | null; reason: string }[] = [];
		let notBefore = 0;
		scenes.forEach((scene, position) => {
			const span = planSceneSpan(scene, context, padMs, notBefore);
			if (!span) {
				skipped.push({
					scene: scene.index,
					title: scene.title,
					reason: `no stretch of at least ${MIN_CUE_MS} ms is left in one shot (too short, cut away or overlapped by the previous caption)`,
				});
				return;
			}
			notBefore = span.endMs;
			built.push(
				createCaptionCue({
					...toSourceSpan(span.startMs, span.endMs, context, `scene ${scene.index}`),
					text: texts[position],
				}),
			);
		});
		if (built.length === 0) {
			throw new Error(
				`No scene has room for a caption: ${skipped.map((s) => s.scene).join(", ")} are all too short or cut away. Nothing was changed.`,
			);
		}
		rejectOverlap(built, "The scene captions");
		const cues = built.reduce<CaptionCue[]>(addCue, []);
		apply(context, cues);
		context.timeline.setSelectedCaptionId(null);
		return withPreview(
			{
				count: cues.length,
				cues: cues.map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text })),
				skipped,
				note: "Replaced all existing captions. Cue times are recording (source) times.",
			},
			preview,
			context,
			captionsEdited(cues, context),
			() => captionMoment(cues[0], context, "the first caption"),
		);
	},

	"captions.generate": async (payload, context) => {
		const args = requireObject(payload, "captions.generate");
		const from = args.from;
		if (typeof from !== "string" || !SOURCES.includes(from)) {
			throw new Error(`from must be one of: ${SOURCES.join(", ")}.`);
		}
		let timeoutMs = DEFAULT_WHISPER_TIMEOUT_MS;
		if (args.timeoutMs !== undefined) {
			timeoutMs = requireFiniteNumber(args.timeoutMs, "timeoutMs");
			if (timeoutMs < MIN_WHISPER_TIMEOUT_MS || timeoutMs > MAX_WHISPER_TIMEOUT_MS) {
				throw new Error(
					`timeoutMs must be between ${MIN_WHISPER_TIMEOUT_MS} and ${MAX_WHISPER_TIMEOUT_MS}.`,
				);
			}
		}
		requireSource(context);
		if (generation) {
			const seconds = Math.round((Date.now() - generation.startedAt) / 1000);
			throw new Error(
				`Captions from ${generation.source} are still being generated (running for ${seconds} s). Wait for them to finish.`,
			);
		}
		generation = { source: from, startedAt: Date.now() };
		try {
			const cues =
				from === "scenes"
					? await cuesFromScenes(context)
					: await cuesFromAudio(context, timeoutMs);
			apply(context, cues);
			return {
				from,
				count: cues.length,
				cues: cues.map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text })),
				note: "Cue times are recording (source) times; cut sections hide their captions.",
			};
		} finally {
			generation = null;
		}
	},

	"captions.set": (payload, context) => {
		const args = requireObject(payload, "captions.set");
		const preview = requirePreviewFlag(args.preview);
		if (!Array.isArray(args.cues) || args.cues.length === 0) {
			throw new Error("cues must be a non-empty list of { startMs, endMs, text }.");
		}
		const built = args.cues.map((raw, index) => {
			const field = `cues[${index}]`;
			const cue = requireObject(raw, field);
			const span = toSourceSpan(
				requireFiniteNumber(cue.startMs, `${field}.startMs`),
				requireFiniteNumber(cue.endMs, `${field}.endMs`),
				context,
				field,
			);
			return createCaptionCue({ ...span, text: requireText(cue.text, `${field}.text`) });
		});
		rejectOverlap(built, "The captions");
		const cues = built.reduce<CaptionCue[]>(addCue, []);
		apply(context, cues);
		context.timeline.setSelectedCaptionId(null);
		return withPreview(
			{ count: cues.length, ids: cues.map((cue) => cue.id) },
			preview,
			context,
			captionsEdited(cues, context),
			() => captionMoment(cues[0], context, "the first caption"),
		);
	},

	"captions.update": (payload, context) => {
		const args = requireObject(payload, "captions.update");
		const preview = requirePreviewFlag(args.preview);
		const id = requireText(args.id, "id");
		const current = context.timeline.autoCaptions;
		const cue = current.find((value) => value.id === id);
		if (!cue) throw new Error(`There is no caption with id "${id}".`);
		const hasText = args.text !== undefined;
		const hasTime = args.startMs !== undefined || args.endMs !== undefined;
		if (!hasText && !hasTime) throw new Error("Give text, or startMs and endMs, to change.");
		let next = current;
		if (hasText) {
			const text = requireText(args.text, "text");
			next = next.map((value) =>
				value.id === id ? { id, startMs: value.startMs, endMs: value.endMs, text } : value,
			);
		}
		if (hasTime) {
			if (args.startMs === undefined || args.endMs === undefined) {
				throw new Error("startMs and endMs must be given together.");
			}
			const span = toSourceSpan(
				requireFiniteNumber(args.startMs, "startMs"),
				requireFiniteNumber(args.endMs, "endMs"),
				context,
				"The new time",
			);
			next = retimeCue(next, id, span);
			rejectOverlap(next, "The captions", id);
		}
		context.timeline.setAutoCaptions(next);
		return withPreview({ id }, preview, context, { timeline: { autoCaptions: next } }, () =>
			captionMoment(
				next.find((value) => value.id === id) as CaptionCue,
				context,
				"the changed caption",
			),
		);
	},

	"captions.remove": (payload, context) => {
		const args = requireObject(payload, "captions.remove");
		const current = context.timeline.autoCaptions;
		if (args.all !== undefined) {
			if (args.all !== true || args.id !== undefined) {
				throw new Error("Give either id, or all: true, not both.");
			}
			if (current.length === 0) throw new Error("There are no captions to remove.");
			context.timeline.setAutoCaptions([]);
			context.timeline.setSelectedCaptionId(null);
			return { removed: current.length };
		}
		const id = requireText(args.id, "id");
		if (!current.some((cue) => cue.id === id)) {
			throw new Error(`There is no caption with id "${id}".`);
		}
		context.timeline.setAutoCaptions(deleteCue(current, id));
		if (context.timeline.selectedCaptionId === id) context.timeline.setSelectedCaptionId(null);
		return { removed: 1 };
	},

	"captions.style": (payload, context) => {
		const args = requireObject(payload, "captions.style");
		const allowed = [...Object.keys(NUMBER_STYLES), ...COLOR_STYLES, "enabled"];
		const given = Object.keys(args).filter((key) => args[key] !== undefined);
		if (given.length === 0) throw new Error(`Give at least one of: ${allowed.join(", ")}.`);
		const patch: Partial<AutoCaptionSettings> = {};
		for (const key of given) {
			const value = args[key];
			if (key === "enabled") {
				if (typeof value !== "boolean") throw new Error("enabled must be true or false.");
				patch.enabled = value;
			} else if (COLOR_STYLES.includes(key)) {
				if (typeof value !== "string" || !COLOR.test(value)) {
					throw new Error(`${key} must be a hex colour such as #FFFFFF.`);
				}
				Object.assign(patch, { [key]: value });
			} else if (key in NUMBER_STYLES) {
				const [min, max, whole] = NUMBER_STYLES[key];
				const number = requireFiniteNumber(value, key);
				if (number < min || number > max || (whole && !Number.isInteger(number))) {
					throw new Error(
						`${key} must be ${whole ? "a whole number " : ""}from ${min} to ${max}.`,
					);
				}
				Object.assign(patch, { [key]: number });
			} else {
				throw new Error(
					`"${key}" is not a caption style. Use one of: ${allowed.join(", ")}.`,
				);
			}
		}
		context.timeline.setAutoCaptionSettings((current) => ({ ...current, ...patch }));
		return { applied: patch };
	},

	"captions.animation": (payload, context) => {
		const args = requireObject(payload, "captions.animation");
		const style = args.style;
		if (typeof style !== "string" || !ANIMATIONS.includes(style as AutoCaptionAnimation)) {
			throw new Error(`style must be one of: ${ANIMATIONS.join(", ")}.`);
		}
		context.timeline.setAutoCaptionSettings((current) => ({
			...current,
			animationStyle: style as AutoCaptionAnimation,
		}));
		return { style };
	},
};
