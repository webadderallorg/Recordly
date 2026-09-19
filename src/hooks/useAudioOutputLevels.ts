import { useEffect, useState } from "react";

export interface AudioOutputLevelEvent {
	deviceId: string;
	rms: number;
	peak: number;
	level: number;
}

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

export function normalizeAudioOutputLevelEvent(event: unknown): AudioOutputLevelEvent | null {
	if (!event || typeof event !== "object") return null;
	const candidate = event as Partial<AudioOutputLevelEvent>;
	if (
		typeof candidate.deviceId !== "string" ||
		candidate.deviceId.length === 0 ||
		typeof candidate.rms !== "number" ||
		!Number.isFinite(candidate.rms) ||
		typeof candidate.peak !== "number" ||
		!Number.isFinite(candidate.peak) ||
		typeof candidate.level !== "number" ||
		!Number.isFinite(candidate.level)
	) {
		return null;
	}

	return {
		deviceId: candidate.deviceId,
		rms: clamp(candidate.rms, 0, 1),
		peak: clamp(candidate.peak, 0, 1),
		level: clamp(candidate.level, 0, 100),
	};
}

export function mergeAudioOutputLevel(
	levels: Record<string, number>,
	event: AudioOutputLevelEvent,
): Record<string, number> {
	return { ...levels, [event.deviceId]: event.level };
}

export function useAudioOutputLevels(options: {
	enabled: boolean;
	deviceIds: string[];
}): Record<string, number> {
	const [levels, setLevels] = useState<Record<string, number>>({});
	const deviceFingerprint = options.deviceIds.join("\u0000");

	useEffect(() => {
		let mounted = true;
		setLevels({});

		const api =
			typeof window !== "undefined" && window.electronAPI
				? window.electronAPI
				: null;
		if (
			!options.enabled ||
			!api?.startAudioOutputLevelMonitor ||
			!api.stopAudioOutputLevelMonitor ||
			!api.onAudioOutputLevel
		) {
			return () => {
				mounted = false;
				setLevels({});
			};
		}

		const unsubscribe = api.onAudioOutputLevel((payload) => {
			if (!mounted) return;
			const event = normalizeAudioOutputLevelEvent(payload);
			if (!event) return;
			setLevels((currentLevels) => mergeAudioOutputLevel(currentLevels, event));
		});

		const monitorDeviceFingerprint = deviceFingerprint;
		void api.startAudioOutputLevelMonitor().then((result) => {
			if (!result.success) {
				console.warn(
					"System audio level monitor unavailable:",
					result.error,
					monitorDeviceFingerprint,
				);
			}
		});

		return () => {
			mounted = false;
			unsubscribe();
			void api.stopAudioOutputLevelMonitor();
			setLevels({});
		};
	}, [deviceFingerprint, options.enabled]);

	return levels;
}
