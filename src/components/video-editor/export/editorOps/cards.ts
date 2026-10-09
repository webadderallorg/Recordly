import { getRenderableAssetUrl, isAbsoluteLocalAssetPath } from "@/lib/assetPath";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_STYLE,
	getTimelineDurationMs,
	sortClipRegions,
} from "../../types";
import { applyTimelineInsert, freezeClip, NO_CLIPS, requireInsertMs } from "./timeline";
import {
	type EditorOpContext,
	type EditorOpMap,
	nextId,
	rejectUnknown,
	requireObject,
} from "./types";

type CardKind = "title" | "end";
type CardPosition = "start" | "end";

const MAX_CARD_TEXT = 200;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"];

const TITLE_FONT_SIZE = 76;
const END_FONT_SIZE = 60;
const SUBTITLE_FONT_SIZE = 34;

function requireCardText(value: unknown, field: string, op: string): string {
	if (typeof value !== "string") throw new Error(`${op}: ${field} must be a string.`);
	const text = value.trim();
	if (text.length > MAX_CARD_TEXT) {
		throw new Error(
			`${op}: ${field} is ${text.length} characters; a card holds at most ${MAX_CARD_TEXT}. Shorten it or use a lower third.`,
		);
	}
	return text;
}

function requireBackground(value: unknown, op: string): string {
	if (value === undefined) return "#000000";
	if (typeof value !== "string" || !HEX_COLOR.test(value.trim())) {
		throw new Error(
			`${op}: background must be a hex colour such as "#000000" or "#111". It fills the whole card.`,
		);
	}
	return value.trim().toUpperCase();
}

function requirePosition(value: unknown, kind: CardKind, op: string): CardPosition {
	if (value === undefined) return kind === "title" ? "start" : "end";
	if (value !== "start" && value !== "end") {
		throw new Error(`${op}: position must be "start" or "end".`);
	}
	return value;
}

async function requireLogoDataUrl(value: unknown, op: string): Promise<string | null> {
	if (value === undefined) return null;
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${op}: logo must be the absolute path of an image file.`);
	}
	const path = value.trim();
	if (!isAbsoluteLocalAssetPath(path)) {
		throw new Error(`${op}: logo must be an absolute path; "${path}" is not.`);
	}
	const lower = path.toLowerCase();
	if (!LOGO_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
		throw new Error(
			`${op}: logo must be one of ${LOGO_EXTENSIONS.join(", ")}; "${path}" is not.`,
		);
	}
	const dataUrl = await getRenderableAssetUrl(path);
	if (!dataUrl.startsWith("data:image/")) {
		throw new Error(
			`${op}: the logo at "${path}" could not be read. Check the file exists and is readable.`,
		);
	}
	return dataUrl;
}

function cardAnnotation(
	context: EditorOpContext,
	startMs: number,
	endMs: number,
	part: Partial<AnnotationRegion> & Pick<AnnotationRegion, "type" | "position" | "size">,
): AnnotationRegion {
	return {
		id: nextId(context.ids.annotation, "annotation"),
		startMs,
		endMs,
		content: "",
		style: { ...DEFAULT_ANNOTATION_STYLE },
		zIndex: context.ids.annotationZIndex.current++,
		trackIndex: 0,
		space: "screen",
		...part,
	};
}

async function addCard(payload: unknown, context: EditorOpContext, kind: CardKind) {
	const op = `card.${kind}`;
	const clips = sortClipRegions(context.timeline.clipRegions);
	// A card is words over a held frame. Blank time carries no annotations, so with
	// no footage to hold there is nothing to put them on.
	if (clips.length === 0) throw new Error(NO_CLIPS);
	const args = requireObject(payload, op);
	rejectUnknown(args, ["text", "subtitle", "background", "logo", "durationMs", "position"], op);
	const text = requireCardText(args.text, "text", op);
	if (!text) {
		throw new Error(`${op}: text is empty. A card with no words is a blank screen.`);
	}
	const subtitle =
		args.subtitle === undefined ? "" : requireCardText(args.subtitle, "subtitle", op);
	const background = requireBackground(args.background, op);
	const durationMs = requireInsertMs(args.durationMs, "durationMs");
	const position = requirePosition(args.position, kind, op);
	const logo = await requireLogoDataUrl(args.logo, op);

	const atMs =
		position === "start"
			? 0
			: getTimelineDurationMs(clips, Math.round(context.duration * 1000));
	const endMs = atMs + durationMs;
	const annotations: AnnotationRegion[] = [
		cardAnnotation(context, atMs, endMs, {
			type: "text",
			position: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			style: {
				...DEFAULT_ANNOTATION_STYLE,
				backgroundColor: background,
				borderRadius: 0,
				fillBox: true,
			},
		}),
	];
	if (logo) {
		annotations.push(
			cardAnnotation(context, atMs, endMs, {
				type: "image",
				content: logo,
				imageContent: logo,
				position: { x: 40, y: 16 },
				size: { width: 20, height: 16 },
			}),
		);
	}
	annotations.push(
		cardAnnotation(context, atMs, endMs, {
			type: "text",
			content: text,
			textContent: text,
			position: { x: 10, y: logo ? 36 : 30 },
			size: { width: 80, height: 26 },
			style: {
				...DEFAULT_ANNOTATION_STYLE,
				fontSize: kind === "title" ? TITLE_FONT_SIZE : END_FONT_SIZE,
			},
		}),
	);
	if (subtitle) {
		annotations.push(
			cardAnnotation(context, atMs, endMs, {
				type: "text",
				content: subtitle,
				textContent: subtitle,
				position: { x: 15, y: logo ? 63 : 57 },
				size: { width: 70, height: 12 },
				style: {
					...DEFAULT_ANNOTATION_STYLE,
					fontSize: SUBTITLE_FONT_SIZE,
					fontWeight: "normal",
				},
			}),
		);
	}

	const applied = applyTimelineInsert(
		context,
		clips,
		atMs,
		freezeClip(context, clips, atMs, durationMs),
	);
	context.timeline.setAnnotationRegions((current) => [...current, ...annotations]);
	return {
		...applied,
		card: { kind, position, startMs: atMs, endMs, annotationIds: annotations.map((a) => a.id) },
	};
}

export const cardsOps: EditorOpMap = {
	"card.title": (payload, context) => addCard(payload, context, "title"),
	"card.end": (payload, context) => addCard(payload, context, "end"),
};
