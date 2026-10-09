import { getTimelineDurationMs } from "../../types";
import { renderPreview } from "./preview";
import type { EditorOpContext } from "./types";

export type EditedState = {
	timeline?: Partial<EditorOpContext["timeline"]>;
	appearance?: Partial<EditorOpContext["appearance"]>;
};

export type PreviewMoment = { atMs: number; why: string };

export function requirePreviewFlag(value: unknown) {
	if (value === undefined) return false;
	if (typeof value !== "boolean") throw new Error("preview must be true or false.");
	return value;
}

export function midpointMs(startMs: number, endMs: number, context: EditorOpContext) {
	const total = getTimelineDurationMs(
		context.timeline.clipRegions,
		Math.round(context.duration * 1000),
	);
	return Math.min(Math.max(Math.round((startMs + endMs) / 2), 0), total);
}

async function previewOf(context: EditorOpContext, edited: EditedState, moment: PreviewMoment) {
	const after: EditorOpContext = {
		...context,
		timeline: { ...context.timeline, ...edited.timeline },
		appearance: { ...context.appearance, ...edited.appearance },
	};
	const sheet = await renderPreview({ atMs: moment.atMs }, after);
	return {
		image: sheet.image,
		atMs: sheet.frames[0].atMs,
		rendered: sheet.rendered,
		notRendered: sheet.notRendered,
		reused: sheet.reused,
		note: `${moment.why} ${sheet.note}`,
	};
}

export function withPreview<T extends object>(
	result: T,
	wanted: boolean,
	context: EditorOpContext,
	edited: EditedState,
	moment: () => PreviewMoment,
): T | Promise<T & { preview?: Awaited<ReturnType<typeof previewOf>>; previewError?: string }> {
	if (!wanted) return result;
	return (async () => {
		try {
			return { ...result, preview: await previewOf(context, edited, moment()) };
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return {
				...result,
				previewError: `The edit was applied and is in the undo history, but no preview could be made: ${reason}`,
			};
		}
	})();
}
