import { useEffect, useRef, useState } from "react";
import type { KeystrokeTelemetryPoint } from "../videoPlayback/keystrokeOverlay/keystrokeTypes";

export function useKeystrokeTelemetry(videoSourcePath: string | null) {
	const [keystrokeSamples, setKeystrokeSamples] = useState<KeystrokeTelemetryPoint[]>([]);
	const pendingRetryTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		let mounted = true;
		let retryAttempts = 0;
		const scheduleRetry = () => {
			if (!mounted || retryAttempts >= 12) {
				return;
			}
			retryAttempts += 1;
			pendingRetryTimeoutRef.current = window.setTimeout(() => {
				pendingRetryTimeoutRef.current = null;
				if (mounted) {
					void load();
				}
			}, 350);
		};
		async function load() {
			if (!videoSourcePath) {
				if (mounted) {
					setKeystrokeSamples([]);
				}
				return;
			}
			try {
				const result = await window.electronAPI.getKeystrokeTelemetry(videoSourcePath);
				if (!mounted) {
					return;
				}
				const samples = result.success ? result.samples : [];
				setKeystrokeSamples(samples);
				if (samples.length === 0) {
					scheduleRetry();
				}
			} catch {
				console.warn("Unable to load keystroke telemetry");
				if (!mounted) {
					return;
				}
				setKeystrokeSamples([]);
				scheduleRetry();
			}
		}

		if (pendingRetryTimeoutRef.current !== null) {
			window.clearTimeout(pendingRetryTimeoutRef.current);
			pendingRetryTimeoutRef.current = null;
		}
		void load();
		return () => {
			mounted = false;
			if (pendingRetryTimeoutRef.current !== null) {
				window.clearTimeout(pendingRetryTimeoutRef.current);
				pendingRetryTimeoutRef.current = null;
			}
		};
	}, [videoSourcePath]);

	return { keystrokeSamples };
}
