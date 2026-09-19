import fs from "node:fs/promises";
import { readAppSetting } from "../../appSettingsStore";
import { KEYSTROKE_TELEMETRY_VERSION, MAX_KEYSTROKE_SAMPLES } from "../constants";
import {
	activeKeystrokeSamples,
	isKeystrokeCaptureActive,
	pendingKeystrokeSamples,
	setPendingKeystrokeSamples,
} from "../state";
import type { KeystrokeModifier, KeystrokeTelemetryPoint } from "../types";
import { getKeystrokePathForVideo, normalizeVideoSourcePath } from "../utils";
import { getCursorCaptureElapsedMs, isCursorCapturePaused } from "./telemetry";

const EDITOR_PREFERENCES_SETTING_KEY = "recordly.editor.preferences";
const KEY_REPEAT_COLLAPSE_MS = 45;
const MODIFIER_ORDER: KeystrokeModifier[] = ["meta", "ctrl", "alt", "shift"];
const BARE_MODIFIER_KEYS = new Set([
	"shift",
	"shiftright",
	"rshift",
	"ctrl",
	"ctrlright",
	"rctrl",
	"alt",
	"altright",
	"ralt",
	"altgr",
	"option",
	"meta",
	"metaright",
	"rmeta",
	"cmd",
	"command",
	"win",
	"windows",
	"super",
]);

let lastSeenKeyToken: string | null = null;
let lastSeenTimeMs = Number.NEGATIVE_INFINITY;

export function isBareModifierKey(token: string): boolean {
	return BARE_MODIFIER_KEYS.has(token);
}

export function resetKeystrokeRepeatState() {
	lastSeenKeyToken = null;
	lastSeenTimeMs = Number.NEGATIVE_INFINITY;
}

export function shouldCollapseKeyRepeat(
	token: string,
	timeMs: number,
	lastToken: string | null,
	lastTimeMs: number,
	windowMs = KEY_REPEAT_COLLAPSE_MS,
): boolean {
	return lastToken === token && timeMs - lastTimeMs < windowMs;
}

export function noteKeystrokeRepeat(token: string, timeMs: number): boolean {
	const collapse = shouldCollapseKeyRepeat(token, timeMs, lastSeenKeyToken, lastSeenTimeMs);
	lastSeenTimeMs = timeMs;
	if (!collapse) {
		lastSeenKeyToken = token;
	}
	return collapse;
}

export function isKeystrokeCaptureEnabledFromPrefs(): boolean {
	const prefs = readAppSetting(EDITOR_PREFERENCES_SETTING_KEY);
	if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
		return false;
	}
	const overlay = (prefs as { keystrokeOverlay?: unknown }).keystrokeOverlay;
	if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) {
		return false;
	}
	return (overlay as { enabled?: unknown }).enabled === true;
}

export function isExplicitKeystrokeTelemetryPathDenied(
	videoPath: string | undefined,
	isAllowedPath: (candidatePath: string) => boolean,
): boolean {
	const explicitVideoPath = normalizeVideoSourcePath(videoPath);
	return Boolean(explicitVideoPath && !isAllowedPath(explicitVideoPath));
}

function normalizeModifiers(raw: unknown): KeystrokeModifier[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const seen = new Set<KeystrokeModifier>();
	for (const value of raw) {
		if (value === "meta" || value === "ctrl" || value === "alt" || value === "shift") {
			seen.add(value);
		}
	}
	return MODIFIER_ORDER.filter((modifier) => seen.has(modifier));
}

export function normalizeKeystrokeTelemetrySamples(rawSamples: unknown): KeystrokeTelemetryPoint[] {
	const samples = Array.isArray(rawSamples)
		? rawSamples
		: Array.isArray((rawSamples as { samples?: unknown[] } | null | undefined)?.samples)
			? ((rawSamples as { samples: unknown[] }).samples ?? [])
			: [];

	return samples
		.filter((sample: unknown): sample is Record<string, unknown> =>
			Boolean(sample && typeof sample === "object" && !Array.isArray(sample)),
		)
		.flatMap((sample) => {
			if (typeof sample.timeMs !== "number" || !Number.isFinite(sample.timeMs)) {
				return [];
			}
			if (typeof sample.key !== "string") {
				return [];
			}
			const key = sample.key.trim().toLowerCase();
			if (!key || isBareModifierKey(key)) {
				return [];
			}
			return [
				{
					timeMs: Math.max(0, sample.timeMs),
					key,
					modifiers: normalizeModifiers(sample.modifiers),
				},
			];
		})
		.sort((left, right) => left.timeMs - right.timeMs)
		.slice(0, MAX_KEYSTROKE_SAMPLES);
}

export async function writeKeystrokeTelemetry(videoPath: string, samples: unknown) {
	const telemetryPath = getKeystrokePathForVideo(videoPath);
	const normalizedSamples = normalizeKeystrokeTelemetrySamples(samples);

	if (normalizedSamples.length === 0) {
		await fs.rm(telemetryPath, { force: true });
		return normalizedSamples;
	}

	await fs.writeFile(
		telemetryPath,
		JSON.stringify(
			{ version: KEYSTROKE_TELEMETRY_VERSION, samples: normalizedSamples },
			null,
			2,
		),
		"utf-8",
	);

	return normalizedSamples;
}

export function pushKeystrokeSample(point: KeystrokeTelemetryPoint) {
	if (!isKeystrokeCaptureActive || isCursorCapturePaused()) {
		return;
	}

	activeKeystrokeSamples.push({
		timeMs: Math.max(0, point.timeMs),
		key: point.key,
		modifiers: point.modifiers,
	});

	if (activeKeystrokeSamples.length > MAX_KEYSTROKE_SAMPLES) {
		activeKeystrokeSamples.shift();
	}
}

function omitOwnModifier(token: string, modifiers: KeystrokeModifier[]): KeystrokeModifier[] {
	if (token === "meta" || token === "ctrl" || token === "alt" || token === "shift") {
		return modifiers.filter((modifier) => modifier !== token);
	}
	return modifiers;
}

export function recordKeystroke(token: string, modifiers: KeystrokeModifier[]) {
	if (!isKeystrokeCaptureActive || isCursorCapturePaused()) {
		return;
	}

	const key = token.trim().toLowerCase();
	if (!key || isBareModifierKey(key)) {
		return;
	}

	const timeMs = getCursorCaptureElapsedMs();
	if (noteKeystrokeRepeat(key, timeMs)) {
		return;
	}

	pushKeystrokeSample({
		timeMs,
		key,
		modifiers: omitOwnModifier(key, normalizeModifiers(modifiers)),
	});
}

export function snapshotKeystrokeTelemetryForPersistence() {
	if (activeKeystrokeSamples.length === 0) {
		return;
	}

	if (pendingKeystrokeSamples.length === 0) {
		setPendingKeystrokeSamples([...activeKeystrokeSamples]);
		return;
	}

	const lastPendingTimeMs =
		pendingKeystrokeSamples[pendingKeystrokeSamples.length - 1]?.timeMs ?? -1;
	setPendingKeystrokeSamples([
		...pendingKeystrokeSamples,
		...activeKeystrokeSamples.filter((sample) => sample.timeMs > lastPendingTimeMs),
	]);
}

export async function persistPendingKeystrokeTelemetry(videoPath: string) {
	if (pendingKeystrokeSamples.length === 0) {
		return;
	}

	await writeKeystrokeTelemetry(videoPath, pendingKeystrokeSamples);
	setPendingKeystrokeSamples([]);
}
