import fs from "node:fs/promises";
import {
	KEYSTROKE_OVERLAY_CAPTURE_SETTING,
	KEYSTROKE_TELEMETRY_VERSION,
	type KeystrokeSample,
	normalizeKeystrokeSamples,
	parseKeyMonitorLine,
	shouldStoreCapturedKeystroke,
} from "../../../src/lib/keystrokeOverlay";
import { readAppSetting } from "../../appSettingsStore";
import { MAX_CURSOR_SAMPLES } from "../constants";
import {
	activeKeystrokeSamples,
	isCursorCaptureActive,
	pendingKeystrokeSamples,
	setActiveKeystrokeSamples,
	setIsKeystrokeCaptureEnabled,
	setPendingKeystrokeSamples,
	isKeystrokeCaptureEnabled,
} from "../state";
import { getKeystrokePathForVideo } from "../utils";
import { getCursorCaptureElapsedMs, isCursorCapturePaused } from "./telemetry";

const MAX_KEYSTROKE_SAMPLES = MAX_CURSOR_SAMPLES;

export function isKeystrokeOverlayCaptureSettingEnabled() {
	return readAppSetting(KEYSTROKE_OVERLAY_CAPTURE_SETTING) === true;
}

export function syncKeystrokeCaptureEnabledFromSettings() {
	setIsKeystrokeCaptureEnabled(isKeystrokeOverlayCaptureSettingEnabled());
	return isKeystrokeCaptureEnabled;
}

export function resetKeystrokeCapture() {
	setActiveKeystrokeSamples([]);
	setPendingKeystrokeSamples([]);
}

function inspectLinuxFocusedFieldPasswordState(): boolean | "unknown" {
	return "unknown";
}

export function pushKeystrokeSample(
	sample: KeystrokeSample,
	isPasswordField: boolean | "unknown" = "unknown",
) {
	if (!isCursorCaptureActive || isCursorCapturePaused() || !isKeystrokeCaptureEnabled) {
		return;
	}

	if (
		!shouldStoreCapturedKeystroke(sample, {
			platform: process.platform,
			isPasswordField,
		})
	) {
		return;
	}

	activeKeystrokeSamples.push(sample);
	if (activeKeystrokeSamples.length > MAX_KEYSTROKE_SAMPLES) {
		activeKeystrokeSamples.shift();
	}
}

export function recordKeystrokeFromMonitorLine(line: string) {
	const parsed = parseKeyMonitorLine(line);
	if (!parsed || parsed.action !== "down") {
		return;
	}

	pushKeystrokeSample(
		{
			timeMs: getCursorCaptureElapsedMs(),
			key: parsed.key,
			code: parsed.code,
			ctrl: parsed.ctrl,
			alt: parsed.alt,
			shift: parsed.shift,
			meta: parsed.meta,
			repeat: parsed.repeat || undefined,
		},
		false,
	);
}

export function recordKeystrokeFromHookEvent(event: {
	keycode?: number;
	rawcode?: number;
	keychar?: number;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	repeat?: boolean;
} | null) {
	if (!event) {
		return;
	}

	const key = mapUiohookKey(event);
	if (!key) {
		return;
	}

	const isPasswordField =
		process.platform === "linux" ? inspectLinuxFocusedFieldPasswordState() : "unknown";

	pushKeystrokeSample(
		{
			timeMs: getCursorCaptureElapsedMs(),
			key,
			code: key,
			ctrl: event.ctrlKey === true,
			alt: event.altKey === true,
			shift: event.shiftKey === true,
			meta: event.metaKey === true,
			repeat: event.repeat === true ? true : undefined,
		},
		isPasswordField,
	);
}

const UIOHOOK_SPECIAL: Record<number, string> = {
	1: "Escape",
	14: "Backspace",
	15: "Tab",
	28: "Enter",
	57: "Space",
	3655: "Home",
	3663: "End",
	3657: "PageUp",
	3665: "PageDown",
	3666: "Insert",
	3667: "Delete",
	57416: "ArrowUp",
	57419: "ArrowLeft",
	57421: "ArrowRight",
	57424: "ArrowDown",
	3675: "Meta",
	3676: "Meta",
	56: "Alt",
	3640: "Alt",
	29: "Control",
	3613: "Control",
	42: "Shift",
	54: "Shift",
};

function mapUiohookKey(event: { keycode?: number; rawcode?: number; keychar?: number }) {
	const keycode = event.keycode ?? 0;
	if (UIOHOOK_SPECIAL[keycode]) {
		return UIOHOOK_SPECIAL[keycode];
	}
	if (keycode >= 59 && keycode <= 68) {
		return `F${keycode - 58}`;
	}
	if (keycode >= 87 && keycode <= 88) {
		return `F${keycode - 76}`;
	}
	if (typeof event.keychar === "number" && event.keychar >= 32 && event.keychar <= 126) {
		return String.fromCharCode(event.keychar);
	}

	const letterByCode: Record<number, string> = {
		16: "Q",
		17: "W",
		18: "E",
		19: "R",
		20: "T",
		21: "Y",
		22: "U",
		23: "I",
		24: "O",
		25: "P",
		30: "A",
		31: "S",
		32: "D",
		33: "F",
		34: "G",
		35: "H",
		36: "J",
		37: "K",
		38: "L",
		44: "Z",
		45: "X",
		46: "C",
		47: "V",
		48: "B",
		49: "N",
		50: "M",
		2: "1",
		3: "2",
		4: "3",
		5: "4",
		6: "5",
		7: "6",
		8: "7",
		9: "8",
		10: "9",
		11: "0",
	};
	return letterByCode[keycode] ?? (keycode ? `Key${keycode}` : "");
}

export async function writeKeystrokeTelemetry(videoPath: string, samples: unknown) {
	const telemetryPath = getKeystrokePathForVideo(videoPath);
	const normalizedSamples = normalizeKeystrokeSamples(samples);

	if (normalizedSamples.length === 0) {
		await fs.rm(telemetryPath, { force: true });
		return normalizedSamples;
	}

	await fs.writeFile(
		telemetryPath,
		JSON.stringify({ version: KEYSTROKE_TELEMETRY_VERSION, samples: normalizedSamples }, null, 2),
		"utf-8",
	);

	return normalizedSamples;
}

export async function persistPendingKeystrokeTelemetry(videoPath: string) {
	if (pendingKeystrokeSamples.length === 0 && activeKeystrokeSamples.length === 0) {
		return;
	}
	snapshotKeystrokeTelemetryForPersistence();
	await writeKeystrokeTelemetry(videoPath, pendingKeystrokeSamples);
	setPendingKeystrokeSamples([]);
}

export function snapshotKeystrokeTelemetryForPersistence() {
	if (activeKeystrokeSamples.length === 0) {
		return;
	}

	if (pendingKeystrokeSamples.length === 0) {
		setPendingKeystrokeSamples([...activeKeystrokeSamples]);
		return;
	}

	const pendingRefs = new Set(pendingKeystrokeSamples);
	setPendingKeystrokeSamples([
		...pendingKeystrokeSamples,
		...activeKeystrokeSamples.filter((sample) => !pendingRefs.has(sample)),
	]);
}

export function dropKeystrokesAfterElapsedMs(elapsedMs: number) {
	setActiveKeystrokeSamples(activeKeystrokeSamples.filter((sample) => sample.timeMs <= elapsedMs));
}

export { normalizeKeystrokeSamples };
