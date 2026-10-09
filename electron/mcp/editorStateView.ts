export const STATE_SECTIONS = [
	"clips",
	"zooms",
	"annotations",
	"audio",
	"captions",
	"speeds",
	"sourceAudio",
	"scenes",
	"look",
	"motion",
] as const;

export type StateSection = (typeof STATE_SECTIONS)[number];

export const CLIP_DETAILS = ["full", "summary", "none"] as const;

export type ClipDetail = (typeof CLIP_DETAILS)[number];

const ALWAYS = ["videoPath", "durationMs", "sourceDurationMs"] as const;

const SECTION_KEYS: Record<StateSection, readonly string[]> = {
	clips: ["clips"],
	zooms: ["zooms"],
	annotations: ["annotations"],
	audio: ["audio"],
	captions: ["captions", "captionSettings"],
	speeds: ["speeds"],
	sourceAudio: ["sourceAudio"],
	scenes: ["scenes"],
	look: ["look", "lookUndoable"],
	motion: ["motion"],
};

export function requireSections(value: unknown): StateSection[] | null {
	if (value === undefined) return null;
	if (!Array.isArray(value)) {
		throw new Error(
			`include must be an array of section names. Accepted: ${STATE_SECTIONS.join(", ")}.`,
		);
	}
	if (value.length === 0) {
		throw new Error(
			`include was empty. Omit it to get everything, or name at least one of: ${STATE_SECTIONS.join(", ")}.`,
		);
	}
	const unknown = value.filter(
		(entry) =>
			typeof entry !== "string" || !(STATE_SECTIONS as readonly string[]).includes(entry),
	);
	if (unknown.length > 0) {
		throw new Error(
			`include has unknown section ${unknown.map((entry) => JSON.stringify(entry)).join(", ")}. Accepted: ${STATE_SECTIONS.join(", ")}.`,
		);
	}
	return [...new Set(value as StateSection[])];
}

export function requireClipDetail(value: unknown): ClipDetail {
	if (value === undefined) return "full";
	if (typeof value !== "string" || !(CLIP_DETAILS as readonly string[]).includes(value)) {
		throw new Error(`clips must be one of: ${CLIP_DETAILS.join(", ")}.`);
	}
	return value as ClipDetail;
}

function summariseClips(clips: unknown[]) {
	let keptMs = 0;
	let speedChanged = 0;
	for (const clip of clips) {
		const { startMs, endMs, speed } = (clip ?? {}) as Record<string, unknown>;
		if (typeof startMs === "number" && typeof endMs === "number" && endMs > startMs) {
			keptMs += endMs - startMs;
		}
		if (typeof speed === "number" && speed !== 1) speedChanged += 1;
	}
	return {
		count: clips.length,
		keptSourceMs: Math.round(keptMs),
		speedChanged,
		note: 'Summary only. Pass clips: "full" for each clip\'s id, times and speed, which edit_timeline needs.',
	};
}

export function projectEditorState(
	state: Record<string, unknown>,
	options: { include?: unknown; clips?: unknown } = {},
) {
	const sections = requireSections(options.include);
	const clipDetail = requireClipDetail(options.clips);
	const wanted = new Set<StateSection>(sections ?? STATE_SECTIONS);
	const view: Record<string, unknown> = {};

	for (const key of ALWAYS) {
		if (state[key] !== undefined) view[key] = state[key];
	}
	for (const section of STATE_SECTIONS) {
		if (!wanted.has(section)) continue;
		if (section === "clips") continue;
		for (const key of SECTION_KEYS[section]) {
			if (state[key] !== undefined) view[key] = state[key];
		}
	}
	if (wanted.has("clips") && clipDetail !== "none") {
		const clips = Array.isArray(state.clips) ? state.clips : [];
		view.clips = clipDetail === "summary" ? summariseClips(clips) : clips;
	}

	const omitted = STATE_SECTIONS.filter((section) => !wanted.has(section));
	if (omitted.length > 0) {
		view.omitted = `${omitted.join(", ")} — call again with include to read them.`;
	}
	return view;
}
