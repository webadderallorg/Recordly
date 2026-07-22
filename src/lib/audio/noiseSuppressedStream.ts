import {
	createNoiseSuppressorWithFallback,
	normalizeNoiseSuppressionMode,
	type NoiseSuppressionMode,
	type NoiseSuppressionSelection,
} from "./noiseSuppression";

const PROCESSOR_BUFFER_SIZE = 1024;
const DEFAULT_SAMPLE_RATE = 48000;
const FRAME_BUDGET_MS = 12;
const LONG_FRAME_LOG_INTERVAL_MS = 5000;

export type NoiseSuppressedMicrophoneStream = {
	stream: MediaStream;
	activeMode: NoiseSuppressionMode;
	requestedMode: NoiseSuppressionMode;
	warnings: string[];
	destroy(): void;
};

export async function createNoiseSuppressedMicrophoneStream({
	sourceStream,
	mode,
	onWarning,
}: {
	sourceStream: MediaStream;
	mode: NoiseSuppressionMode;
	onWarning?: (message: string) => void;
}): Promise<NoiseSuppressedMicrophoneStream> {
	const requestedMode = normalizeNoiseSuppressionMode(mode);
	if (requestedMode === "disabled") {
		console.info("[NoiseSuppression] Microphone stream passthrough selected.");
		return {
			stream: sourceStream,
			activeMode: "disabled",
			requestedMode,
			warnings: [],
			destroy: () => {
				sourceStream.getTracks().forEach((track) => track.stop());
				console.info("[NoiseSuppression] Passthrough stream cleanup complete.");
			},
		};
	}

	const context = new AudioContext({ sampleRate: DEFAULT_SAMPLE_RATE });
	const source = context.createMediaStreamSource(sourceStream);
	const destination = context.createMediaStreamDestination();
	const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
	const sampleRate = context.sampleRate || DEFAULT_SAMPLE_RATE;
	const selection = await createNoiseSuppressorWithFallback({
		mode: requestedMode,
		frameSize: PROCESSOR_BUFFER_SIZE,
		sampleRate,
	});

	reportWarnings(selection, onWarning);

	let droppedFrames = 0;
	let lastLongFrameLogAt = 0;
	const scratchFrame = new Float32Array(PROCESSOR_BUFFER_SIZE);
	processor.onaudioprocess = (event) => {
		const input = event.inputBuffer.getChannelData(0);
		const output = event.outputBuffer.getChannelData(0);
		const startedAt = performance.now();
		try {
			scratchFrame.set(input);
			output.set(selection.suppressor.processAudioFrame(scratchFrame));
		} catch (error) {
			droppedFrames += 1;
			output.set(input);
			console.warn("[NoiseSuppression] Processing error; passed through frame.", {
				activeMode: selection.activeMode,
				droppedFrames,
				error: error instanceof Error ? error.message : String(error),
			});
		}

		const elapsedMs = performance.now() - startedAt;
		const now = performance.now();
		if (elapsedMs > FRAME_BUDGET_MS && now - lastLongFrameLogAt > LONG_FRAME_LOG_INTERVAL_MS) {
			lastLongFrameLogAt = now;
			console.warn("[NoiseSuppression] Processing exceeded real-time budget.", {
				activeMode: selection.activeMode,
				elapsedMs: Number(elapsedMs.toFixed(2)),
				frameSize: PROCESSOR_BUFFER_SIZE,
				sampleRate,
			});
		}
	};

	source.connect(processor);
	processor.connect(destination);
	console.info("[NoiseSuppression] Microphone stream processing active.", {
		requestedMode,
		activeMode: selection.activeMode,
		frameSize: PROCESSOR_BUFFER_SIZE,
		sampleRate,
	});

	return {
		stream: destination.stream,
		activeMode: selection.activeMode,
		requestedMode,
		warnings: selection.warnings,
		destroy: () => {
			processor.disconnect();
			source.disconnect();
			sourceStream.getTracks().forEach((track) => track.stop());
			destination.stream.getTracks().forEach((track) => track.stop());
			selection.suppressor.destroy();
			context.close().catch(() => undefined);
			console.info("[NoiseSuppression] Microphone stream cleanup complete.", {
				requestedMode,
				activeMode: selection.activeMode,
				droppedFrames,
			});
		},
	};
}

function reportWarnings(
	selection: NoiseSuppressionSelection,
	onWarning?: (message: string) => void,
) {
	if (selection.warnings.length === 0) {
		return;
	}

	const message =
		selection.activeMode === "disabled"
			? "Noise suppression is unavailable on this device. Recording will continue without it."
			: `Noise suppression fell back to ${selection.activeMode.toUpperCase()}.`;
	onWarning?.(message);
}
