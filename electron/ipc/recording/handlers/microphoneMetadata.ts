import { type MicrophoneChunkTimingEvent, type MicrophonePauseInterval } from "../diagnostics";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function pickPrimitiveRecord(value: unknown) {
	if (!isRecord(value)) {
		return null;
	}

	const entries = Object.entries(value).filter(
		(entry): entry is [string, boolean | number | string] => {
			const primitive = entry[1];
			return (
				typeof primitive === "boolean" ||
				typeof primitive === "number" ||
				typeof primitive === "string"
			);
		},
	);

	return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function pickMicrophoneChunkEvents(value: unknown): MicrophoneChunkTimingEvent[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const events = value
		.map((event) => {
			if (!isRecord(event)) {
				return null;
			}

			const { index, size, elapsedMs, deltaMs, recordedElapsedMs, recordedDeltaMs } = event;
			if (
				typeof index !== "number" ||
				!Number.isFinite(index) ||
				index < 0 ||
				typeof size !== "number" ||
				!Number.isFinite(size) ||
				size < 0 ||
				typeof elapsedMs !== "number" ||
				!Number.isFinite(elapsedMs) ||
				elapsedMs < 0
			) {
				return null;
			}

			return {
				index: Math.round(index),
				size: Math.round(size),
				elapsedMs: Math.round(elapsedMs),
				deltaMs:
					typeof deltaMs === "number" && Number.isFinite(deltaMs)
						? Math.max(0, Math.round(deltaMs))
						: null,
				...(typeof recordedElapsedMs === "number" &&
				Number.isFinite(recordedElapsedMs) &&
				recordedElapsedMs >= 0
					? { recordedElapsedMs: Math.round(recordedElapsedMs) }
					: {}),
				recordedDeltaMs:
					typeof recordedDeltaMs === "number" && Number.isFinite(recordedDeltaMs)
						? Math.max(0, Math.round(recordedDeltaMs))
						: null,
			};
		})
		.filter((event): event is NonNullable<typeof event> => event !== null);

	return events.length > 0 ? events : null;
}

export function pickMicrophonePauseIntervals(value: unknown): MicrophonePauseInterval[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const intervals = value
		.map((interval) => {
			if (
				!isRecord(interval) ||
				typeof interval.startElapsedMs !== "number" ||
				!Number.isFinite(interval.startElapsedMs) ||
				interval.startElapsedMs < 0
			) {
				return null;
			}

			const startElapsedMs = Math.max(0, Math.round(interval.startElapsedMs));
			return {
				startElapsedMs,
				...(typeof interval.endElapsedMs === "number" &&
				Number.isFinite(interval.endElapsedMs) &&
				interval.endElapsedMs >= startElapsedMs
					? { endElapsedMs: Math.round(interval.endElapsedMs) }
					: {}),
				...(typeof interval.durationMs === "number" &&
				Number.isFinite(interval.durationMs) &&
				interval.durationMs >= 0
					? { durationMs: Math.round(interval.durationMs) }
					: {}),
			};
		})
		.filter((interval): interval is NonNullable<typeof interval> => interval !== null);

	return intervals.length > 0 ? intervals : null;
}

export function pickAudioInputDevices(value: unknown) {
	if (!Array.isArray(value)) {
		return null;
	}

	const devices = value
		.map((device) => {
			if (!isRecord(device) || typeof device.deviceId !== "string") {
				return null;
			}

			return {
				deviceId: device.deviceId,
				...(typeof device.groupId === "string" ? { groupId: device.groupId } : {}),
				label: typeof device.label === "string" ? device.label : "",
			};
		})
		.filter((device): device is NonNullable<typeof device> => device !== null);

	return devices.length > 0 ? devices : null;
}
