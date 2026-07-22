import {
	type NoiseSuppressionMode,
	type NoiseSuppressionSelection,
	normalizeNoiseSuppressionMode,
} from "./noiseSuppression";
import noiseSuppressionWorkletUrl from "./noiseSuppressionWorklet.ts?worker&url";

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

export type NoiseSuppressionWarning =
	| {
			key: "recording.noiseSuppressionUnavailableWarning";
	  }
	| {
			key: "recording.noiseSuppressionFallbackWarning";
			params: { mode: string };
	  };

export async function createNoiseSuppressedMicrophoneStream({
	sourceStream,
	mode,
	onWarning,
}: {
	sourceStream: MediaStream;
	mode: NoiseSuppressionMode;
	onWarning?: (warning: NoiseSuppressionWarning) => void;
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
	const sampleRate = context.sampleRate || DEFAULT_SAMPLE_RATE;
	await context.audioWorklet.addModule(noiseSuppressionWorkletUrl);
	const processor = new AudioWorkletNode(context, "noise-suppression-processor", {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [1],
	});
	const selection = await initializeNoiseSuppressionWorklet(processor, {
		mode: requestedMode,
		frameSize: PROCESSOR_BUFFER_SIZE,
		sampleRate,
		frameBudgetMs: FRAME_BUDGET_MS,
		longFrameLogIntervalMs: LONG_FRAME_LOG_INTERVAL_MS,
	});

	reportWarnings(selection, onWarning);

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
			processor.port.postMessage({ type: "destroy" });
			processor.disconnect();
			source.disconnect();
			sourceStream.getTracks().forEach((track) => track.stop());
			destination.stream.getTracks().forEach((track) => track.stop());
			context.close().catch(() => undefined);
			console.info("[NoiseSuppression] Microphone stream cleanup complete.", {
				requestedMode,
				activeMode: selection.activeMode,
			});
		},
	};
}

type NoiseSuppressionWorkletReadySelection = Omit<NoiseSuppressionSelection, "suppressor">;

async function initializeNoiseSuppressionWorklet(
	processor: AudioWorkletNode,
	config: {
		mode: NoiseSuppressionMode;
		frameSize: number;
		frameBudgetMs: number;
		longFrameLogIntervalMs: number;
		sampleRate: number;
	},
): Promise<NoiseSuppressionWorkletReadySelection> {
	return new Promise((resolve, reject) => {
		processor.port.onmessage = (event) => {
			const message = event.data;
			if (message.type === "ready") {
				resolve({
					requestedMode: message.requestedMode,
					activeMode: message.activeMode,
					warnings: message.warnings,
				});
				return;
			}
			if (message.type === "error") {
				reject(new Error(message.error));
				return;
			}
			if (message.type === "processing-error") {
				console.warn("[NoiseSuppression] Processing error; passed through frame.", {
					activeMode: message.activeMode,
					droppedFrames: message.droppedFrames,
					error: message.error,
				});
				return;
			}
			if (message.type === "long-frame") {
				console.warn("[NoiseSuppression] Processing exceeded real-time budget.", {
					activeMode: message.activeMode,
					elapsedMs: message.elapsedMs,
					frameSize: message.frameSize,
					sampleRate: message.sampleRate,
				});
			}
		};
		processor.port.postMessage({ type: "init", ...config });
	});
}

function reportWarnings(
	selection: Pick<NoiseSuppressionSelection, "activeMode" | "warnings">,
	onWarning?: (warning: NoiseSuppressionWarning) => void,
): NoiseSuppressionWarning | null {
	if (selection.warnings.length === 0) {
		return null;
	}

	const warning: NoiseSuppressionWarning =
		selection.activeMode === "disabled"
			? { key: "recording.noiseSuppressionUnavailableWarning" }
			: {
					key: "recording.noiseSuppressionFallbackWarning",
					params: { mode: selection.activeMode.toUpperCase() },
				};
	onWarning?.(warning);
	return warning;
}
