import fs from "node:fs/promises";
import { clamp, getCursorCaptureElapsedMs } from "../ipc/cursor/telemetry";
import { MAX_CHANGE_TIMES } from "../ipc/ffmpeg/changeTimes";
import { isCursorCaptureActive } from "../ipc/state";
import { getAgentActivityPathForVideo, parseJsonWithByteOrderMark } from "../ipc/utils";

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

const MAX_SCENE_TITLE_LENGTH = 200;

const KINDS = new Set<unknown>(["motion", "hold", "wait"]);
const ACTIONS = new Set<unknown>([
	"move",
	"click",
	"drag",
	"scroll",
	"type",
	"key",
	"wait",
	"raise",
]);

let scenes: AgentActivityScene[] = [];
let spans: AgentActivitySpan[] = [];
let cameraTargets: AgentActivityCameraTarget[] = [];
let frozen = false;

export function resetAgentActivity() {
	scenes = [];
	spans = [];
	cameraTargets = [];
	frozen = false;
}

export function getAgentActivityMs(): number | null {
	return isCursorCaptureActive && !frozen ? getCursorCaptureElapsedMs() : null;
}

function open<T extends { startMs: number; endMs: number }>(
	list: T[],
	entry: Omit<T, "startMs" | "endMs">,
) {
	const startMs = getAgentActivityMs();
	if (startMs === null) return null;
	const opened = { ...entry, startMs, endMs: Number.POSITIVE_INFINITY } as T;
	list.push(opened);
	return opened;
}

function close<T extends { endMs: number }>(entry: T | null, fields: Partial<T> = {}) {
	const endMs = getAgentActivityMs();
	if (entry && endMs !== null && entry.endMs === Number.POSITIVE_INFINITY) {
		Object.assign(entry, fields, { endMs });
	}
}

let plannedTitles: (string | undefined)[] = [];

const cleanTitle = (title: unknown) =>
	typeof title === "string"
		? title.trim().slice(0, MAX_SCENE_TITLE_LENGTH) || undefined
		: undefined;

export function setPlannedSceneTitles(titles: readonly string[] | undefined) {
	plannedTitles = (titles ?? []).map(cleanTitle);
}

export function beginScene(title?: string) {
	const chosen = cleanTitle(title) ?? plannedTitles[scenes.length];
	const scene = open<AgentActivityScene>(scenes, {
		failed: false,
		...(chosen ? { title: chosen } : {}),
	});
	return (failed: boolean) => close(scene, { failed });
}

export function beginSpan(
	kind: AgentActivitySpanKind,
	action: AgentActivityAction,
	target?: AgentActivityTarget,
) {
	const span = open<AgentActivitySpan>(spans, { kind, action, ...(target ? { target } : {}) });
	return () => close(span);
}

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

function isValidRect(rect: { x: number; y: number; width: number; height: number }) {
	return (
		isFiniteNumber(rect.x) &&
		isFiniteNumber(rect.y) &&
		isFiniteNumber(rect.width) &&
		isFiniteNumber(rect.height) &&
		rect.width > 0 &&
		rect.height > 0
	);
}

export function markCameraTarget(
	rect: { x: number; y: number; width: number; height: number },
	label?: string,
): boolean {
	const atMs = getAgentActivityMs();
	if (atMs === null || !isValidRect(rect)) return false;
	const round = (value: number) => Math.round(value * 1e6) / 1e6;
	const unit = (value: number) => round(clamp(value, 0, 1));
	const x = unit(rect.x);
	const y = unit(rect.y);
	const width = round(unit(rect.x + rect.width) - x);
	const height = round(unit(rect.y + rect.height) - y);
	if (width <= 0 || height <= 0) return false;
	cameraTargets.push({ atMs, x, y, width, height, ...(label ? { label } : {}) });
	return true;
}

function clampTimes<T extends { startMs: number; endMs: number }>(entries: T[], stopMs: number) {
	return entries
		.map((entry) => ({
			...entry,
			startMs: clamp(entry.startMs, 0, stopMs),
			endMs: clamp(entry.endMs, 0, stopMs),
		}))
		.filter((entry) => entry.endMs > entry.startMs);
}

export function snapshotAgentActivity(stopMs: number): AgentActivityLog {
	if (!frozen) {
		scenes = clampTimes(scenes, Math.max(0, stopMs));
		spans = clampTimes(spans, Math.max(0, stopMs));
		cameraTargets = cameraTargets.filter((target) => target.atMs < stopMs);
		frozen = true;
	}
	return {
		version: 1,
		scenes,
		spans,
		...(cameraTargets.length > 0 ? { cameraTargets } : {}),
	};
}

export async function persistAgentActivity(
	videoPath: string,
	readChangeTimesMs?: () => Promise<number[] | null>,
) {
	const log: AgentActivityLog = {
		version: 1,
		scenes,
		spans,
		...(cameraTargets.length > 0 ? { cameraTargets } : {}),
	};
	scenes = [];
	spans = [];
	cameraTargets = [];
	if (log.scenes.length === 0 && log.spans.length === 0 && !log.cameraTargets) return;
	if (readChangeTimesMs) {
		try {
			const changeTimesMs = await readChangeTimesMs();
			if (changeTimesMs && changeTimesMs.length > 0) log.changeTimesMs = changeTimesMs;
		} catch (error) {
			console.warn("[agent-activity] Failed to extract screen change times:", error);
		}
	}
	await fs.writeFile(
		getAgentActivityPathForVideo(videoPath),
		JSON.stringify(log, null, 2),
		"utf-8",
	);
}

function normalizeTimes(raw: unknown) {
	const entry = raw as { startMs?: unknown; endMs?: unknown } | null;
	if (!entry || typeof entry !== "object") return null;
	if (!isFiniteNumber(entry.startMs) || !isFiniteNumber(entry.endMs)) return null;
	const startMs = Math.max(0, entry.startMs);
	const endMs = Math.max(0, entry.endMs);
	return endMs > startMs ? { startMs, endMs } : null;
}

function normalizeTarget(raw: unknown): AgentActivityTarget | undefined {
	const target = raw as Partial<Record<keyof AgentActivityTarget, unknown>> | null;
	if (!target || !isFiniteNumber(target.cx) || !isFiniteNumber(target.cy)) return undefined;
	return {
		cx: clamp(target.cx, 0, 1),
		cy: clamp(target.cy, 0, 1),
		...(isFiniteNumber(target.width) ? { width: clamp(target.width, 0, 1) } : {}),
		...(isFiniteNumber(target.height) ? { height: clamp(target.height, 0, 1) } : {}),
	};
}

function normalizeCameraTargets(raw: unknown): AgentActivityCameraTarget[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const targets = raw
		.flatMap((entry: Partial<Record<keyof AgentActivityCameraTarget, unknown>> | null) => {
			if (!entry || typeof entry !== "object") return [];
			const { atMs, x, y, width, height, label } = entry;
			if (!isFiniteNumber(atMs) || !isFiniteNumber(x) || !isFiniteNumber(y)) return [];
			if (!isFiniteNumber(width) || !isFiniteNumber(height)) return [];
			if (width <= 0 || height <= 0) return [];
			return [
				{
					atMs: Math.max(0, atMs),
					x: clamp(x, 0, 1),
					y: clamp(y, 0, 1),
					width: clamp(width, 0, 1),
					height: clamp(height, 0, 1),
					...(typeof label === "string" && label ? { label } : {}),
				},
			];
		})
		.sort((a, b) => a.atMs - b.atMs);
	return targets.length > 0 ? targets : undefined;
}

const byStart = (a: { startMs: number }, b: { startMs: number }) => a.startMs - b.startMs;

function normalizeChangeTimes(raw: unknown): number[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const sorted = raw
		.filter(isFiniteNumber)
		.map((timeMs) => Math.max(0, Math.round(timeMs)))
		.sort((a, b) => a - b);
	const times = sorted
		.filter((timeMs, index) => index === 0 || timeMs !== sorted[index - 1])
		.slice(0, MAX_CHANGE_TIMES);
	return times.length > 0 ? times : undefined;
}

export function normalizeAgentActivityLog(raw: unknown): AgentActivityLog | null {
	const log = raw as {
		version?: unknown;
		scenes?: unknown;
		spans?: unknown;
		changeTimesMs?: unknown;
		cameraTargets?: unknown;
	} | null;
	if (!log || log.version !== 1) return null;
	const rawScenes: unknown[] = Array.isArray(log.scenes) ? log.scenes : [];
	const rawSpans: unknown[] = Array.isArray(log.spans) ? log.spans : [];
	const changeTimesMs = normalizeChangeTimes(log.changeTimesMs);
	const cameraTargets = normalizeCameraTargets(log.cameraTargets);
	return {
		version: 1,
		...(changeTimesMs ? { changeTimesMs } : {}),
		...(cameraTargets ? { cameraTargets } : {}),
		scenes: rawScenes
			.flatMap((raw) => {
				const times = normalizeTimes(raw);
				if (!times) return [];
				const { failed, title } = raw as { failed?: unknown; title?: unknown };
				return [
					{
						...times,
						failed: failed === true,
						...(typeof title === "string" &&
						title.trim() &&
						title.length <= MAX_SCENE_TITLE_LENGTH
							? { title }
							: {}),
					},
				];
			})
			.sort(byStart),
		spans: rawSpans
			.flatMap((raw) => {
				const times = normalizeTimes(raw);
				if (!times) return [];
				const { kind, action, target } = raw as Record<string, unknown>;
				if (!KINDS.has(kind) || !ACTIONS.has(action)) return [];
				const normalizedTarget = normalizeTarget(target);
				return [
					{
						kind: kind as AgentActivitySpanKind,
						action: action as AgentActivityAction,
						...times,
						...(normalizedTarget ? { target: normalizedTarget } : {}),
					},
				];
			})
			.sort(byStart),
	};
}

export async function readAgentActivity(videoPath: string) {
	try {
		const content = await fs.readFile(getAgentActivityPathForVideo(videoPath), "utf-8");
		return normalizeAgentActivityLog(parseJsonWithByteOrderMark<unknown>(content));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
