import { useCallback, useEffect, useRef, useState } from "react";
import { selectMicrophoneTestMimeType } from "./microphoneTestMimeType";

export type MicrophoneTestStatus = "idle" | "recording" | "playing" | "error";
export type MicrophoneTestError =
	| "unsupported"
	| "permission-denied"
	| "capture-failed"
	| "playback-failed";

type UseMicrophoneTestOptions = {
	enabled: boolean;
	deviceId?: string;
};

function getMicrophoneConstraints(deviceId?: string): MediaTrackConstraints {
	if (deviceId) {
		return {
			deviceId: { exact: deviceId },
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		};
	}

	return {
		echoCancellation: true,
		noiseSuppression: true,
		autoGainControl: true,
	};
}

export function useMicrophoneTest({ enabled, deviceId }: UseMicrophoneTestOptions) {
	const [status, setStatus] = useState<MicrophoneTestStatus>("idle");
	const [error, setError] = useState<MicrophoneTestError | null>(null);
	const [hasPlayback, setHasPlayback] = useState(false);
	const [level, setLevel] = useState(0);

	const sessionRef = useRef(0);
	const streamRef = useRef<MediaStream | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const recordedChunksRef = useRef<Blob[]>([]);
	const playbackUrlRef = useRef<string | null>(null);
	const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const previousDeviceIdRef = useRef(deviceId);

	const stopMeter = useCallback(() => {
		if (animationFrameRef.current) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}

		analyserRef.current = null;
		setLevel(0);

		if (audioContextRef.current) {
			audioContextRef.current.close().catch(() => undefined);
			audioContextRef.current = null;
		}
	}, []);

	const stopInputStream = useCallback(() => {
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
		}

		stopMeter();
	}, [stopMeter]);

	const clearPlaybackAudio = useCallback(() => {
		const playbackAudio = playbackAudioRef.current;
		if (!playbackAudio) {
			return;
		}

		playbackAudio.onended = null;
		playbackAudio.onerror = null;
		playbackAudio.pause();
		playbackAudio.src = "";
		playbackAudioRef.current = null;
	}, []);

	const revokePlaybackUrl = useCallback(() => {
		if (!playbackUrlRef.current) {
			return;
		}

		URL.revokeObjectURL(playbackUrlRef.current);
		playbackUrlRef.current = null;
	}, []);

	const reset = useCallback(
		(options: { clearSample?: boolean } = {}) => {
			sessionRef.current += 1;

			const recorder = recorderRef.current;
			if (recorder) {
				recorder.ondataavailable = null;
				recorder.onstop = null;
				try {
					if (recorder.state !== "inactive") {
						recorder.stop();
					}
				} catch {
					// Best effort cleanup; the recorder can already be shutting down.
				}
				recorderRef.current = null;
			}

			stopInputStream();
			clearPlaybackAudio();

			if (options.clearSample ?? true) {
				revokePlaybackUrl();
				recordedChunksRef.current = [];
				setHasPlayback(false);
			}

			setError(null);
			setStatus("idle");
		},
		[clearPlaybackAudio, revokePlaybackUrl, stopInputStream],
	);

	const beginMetering = useCallback(async (stream: MediaStream, session: number) => {
		try {
			const audioContext = new AudioContext();
			if (audioContext.state === "suspended") {
				await audioContext.resume();
			}

			if (sessionRef.current !== session) {
				audioContext.close().catch(() => undefined);
				return;
			}

			audioContextRef.current = audioContext;
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.8;
			analyserRef.current = analyser;

			const source = audioContext.createMediaStreamSource(stream);
			source.connect(analyser);

			const dataArray = new Uint8Array(analyser.frequencyBinCount);

			const updateLevel = () => {
				if (sessionRef.current !== session || !analyserRef.current) {
					return;
				}

				analyserRef.current.getByteFrequencyData(dataArray);

				let sum = 0;
				for (let index = 0; index < dataArray.length; index++) {
					sum += dataArray[index] * dataArray[index];
				}

				const rms = Math.sqrt(sum / dataArray.length);
				const normalizedLevel = Math.min(100, (rms / 255) * 100 * 2);
				setLevel(normalizedLevel);
				animationFrameRef.current = requestAnimationFrame(updateLevel);
			};

			updateLevel();
		} catch (meterError) {
			console.warn("Failed to start microphone test metering:", meterError);
		}
	}, []);

	const playCurrentSample = useCallback(async () => {
		const playbackUrl = playbackUrlRef.current;
		if (!playbackUrl) {
			return;
		}

		clearPlaybackAudio();

		const playbackAudio = new Audio(playbackUrl);
		playbackAudioRef.current = playbackAudio;
		playbackAudio.onended = () => {
			if (playbackAudioRef.current === playbackAudio) {
				playbackAudioRef.current = null;
			}
			setStatus("idle");
		};
		playbackAudio.onerror = () => {
			if (playbackAudioRef.current === playbackAudio) {
				playbackAudioRef.current = null;
			}
			setError("playback-failed");
			setStatus("error");
		};

		try {
			setError(null);
			setStatus("playing");
			await playbackAudio.play();
		} catch {
			if (playbackAudioRef.current === playbackAudio) {
				playbackAudioRef.current = null;
			}
			setError("playback-failed");
			setStatus("error");
		}
	}, [clearPlaybackAudio]);

	const startTest = useCallback(async () => {
		if (
			!enabled ||
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.getUserMedia ||
			typeof MediaRecorder === "undefined"
		) {
			setError("unsupported");
			setStatus("error");
			return;
		}

		reset();

		const session = sessionRef.current;
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: getMicrophoneConstraints(deviceId),
				video: false,
			});

			if (sessionRef.current !== session) {
				stream.getTracks().forEach((track) => track.stop());
				return;
			}

			streamRef.current = stream;
			recordedChunksRef.current = [];

			const mimeType = selectMicrophoneTestMimeType();
			const recorder = mimeType
				? new MediaRecorder(stream, { mimeType })
				: new MediaRecorder(stream);
			recorderRef.current = recorder;

			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					recordedChunksRef.current.push(event.data);
				}
			};

			recorder.onstop = () => {
				recorderRef.current = null;
				stopInputStream();

				if (sessionRef.current !== session) {
					return;
				}

				const chunks = recordedChunksRef.current;
				recordedChunksRef.current = [];

				if (chunks.length === 0) {
					setHasPlayback(false);
					setStatus("idle");
					return;
				}

				revokePlaybackUrl();
				const blobType = recorder.mimeType || mimeType || chunks[0]?.type || "audio/webm";
				const playbackBlob = new Blob(chunks, { type: blobType });
				playbackUrlRef.current = URL.createObjectURL(playbackBlob);
				setHasPlayback(true);
				void playCurrentSample();
			};

			await beginMetering(stream, session);
			setHasPlayback(false);
			setError(null);
			setStatus("recording");
			recorder.start();
		} catch (captureError) {
			stopInputStream();
			const isPermissionError =
				captureError instanceof DOMException &&
				(captureError.name === "NotAllowedError" || captureError.name === "SecurityError");
			setError(isPermissionError ? "permission-denied" : "capture-failed");
			setStatus("error");
		}
	}, [
		beginMetering,
		deviceId,
		enabled,
		playCurrentSample,
		reset,
		revokePlaybackUrl,
		stopInputStream,
	]);

	const stopTest = useCallback(() => {
		if (status === "recording") {
			const recorder = recorderRef.current;
			if (recorder && recorder.state !== "inactive") {
				recorder.stop();
			}
			return;
		}

		if (status === "playing") {
			clearPlaybackAudio();
			setStatus("idle");
		}
	}, [clearPlaybackAudio, status]);

	const playLastTest = useCallback(async () => {
		if (!hasPlayback || !playbackUrlRef.current) {
			return;
		}

		await playCurrentSample();
	}, [hasPlayback, playCurrentSample]);

	useEffect(() => {
		if (!enabled) {
			reset();
		}

		return () => {
			reset();
		};
	}, [enabled, reset]);

	useEffect(() => {
		if (!enabled) {
			previousDeviceIdRef.current = deviceId;
			return;
		}

		const previousDeviceId = previousDeviceIdRef.current;
		previousDeviceIdRef.current = deviceId;

		if (previousDeviceId === deviceId) {
			return;
		}

		reset();
	}, [deviceId, enabled, reset]);

	return {
		error,
		playLastTest,
		startTest,
		status,
		stopTest,
		hasPlayback,
		level,
		supported:
			typeof navigator !== "undefined" &&
			!!navigator.mediaDevices?.getUserMedia &&
			typeof MediaRecorder !== "undefined",
	};
}
