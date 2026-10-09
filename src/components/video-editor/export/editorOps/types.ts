import type { MutableRefObject } from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { AgentActivityLog } from "../../agentEdits/planAgentEdits";
import type { EditorProjectData } from "../../projectPersistence";
import type { useAppearanceState } from "../../state/useAppearanceState";
import type { useTimelineState } from "../../state/useTimelineState";
import type { SpeedRegion } from "../../types";

export type EditorProjectHooks = {
	snapshot: EditorProjectData | null;
	hasUnsavedChanges: boolean;
	isExporting: boolean;
	applyLoaded: (project: unknown, path: string) => Promise<boolean>;
	markSaved: (saved: { path: string; projectId?: string }) => void;
	detach: () => void;
};

export type EditorOpContext = {
	duration: number;
	videoSourcePath: string | null;
	timeline: ReturnType<typeof useTimelineState>;
	appearance: ReturnType<typeof useAppearanceState>;
	history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
	assertSameRecording: () => void;
	adoptJoinedMedia: (media: { path: string; url: string }) => void;
	project?: EditorProjectHooks;
	exportAspectRatio?: AspectRatio;
	effectiveSpeedRegions?: SpeedRegion[];
	effectiveShowCursor?: boolean;
	ids: {
		zoom: MutableRefObject<number>;
		clip: MutableRefObject<number>;
		audio: MutableRefObject<number>;
		annotation: MutableRefObject<number>;
		annotationZIndex: MutableRefObject<number>;
	};
};

export function nextId(ref: MutableRefObject<number>, prefix: string): string {
	const value = ref.current;
	ref.current = value + 1;
	return `${prefix}-${value}`;
}

export type EditorOp = (payload: unknown, context: EditorOpContext) => unknown;

export type EditorOpMap = Record<string, EditorOp>;

export function requireObject(payload: unknown, op: string): Record<string, unknown> {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		throw new Error(`${op} needs an object of arguments.`);
	}
	return payload as Record<string, unknown>;
}

export const ACTIVITY_TIMEOUT_MS = 10_000;

export async function loadAgentActivity(
	videoSourcePath: string | null,
	advice: string,
): Promise<AgentActivityLog> {
	if (!videoSourcePath) throw new Error(`There is no recording loaded. ${advice}`);
	const fetch = window.electronAPI?.getAgentActivity;
	if (!fetch) throw new Error(`The activity log is unavailable here. ${advice}`);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const result = await Promise.race([
			fetch(videoSourcePath),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(
								`Timed out after ${ACTIVITY_TIMEOUT_MS / 1000} seconds waiting for the recording's activity log.`,
							),
						),
					ACTIVITY_TIMEOUT_MS,
				);
			}),
		]);
		if (!result.success || !result.log || result.log.version !== 1) {
			throw new Error(
				`${result.message ?? result.error ?? "This recording has no agent activity log."} ${advice}`,
			);
		}
		return result.log;
	} finally {
		clearTimeout(timer);
	}
}

export function rejectUnknown(args: Record<string, unknown>, allowed: string[], op: string) {
	const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) {
		throw new Error(
			`${op}: unknown field ${unknown.join(", ")}. Accepted: ${allowed.join(", ")}.`,
		);
	}
}

export function requireFiniteNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${field} must be a number.`);
	}
	return value;
}
