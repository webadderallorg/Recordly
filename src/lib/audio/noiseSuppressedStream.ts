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
const WORKLET_READY_TIMEOUT_MS = 5000;

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
	let processor: AudioWorkletNode | null = null;
	let selection: NoiseSuppressionWorkletReadySelection;

	try {
		await context.audioWorklet.addModule(noiseSuppressionWorkletUrl);
		processor = new AudioWorkletNode(context, "noise-suppression-processor", {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [1],
		});
		selection = await initializeNoiseSuppressionWorklet(processor, {
			mode: requestedMode,
			frameSize: PROCESSOR_BUFFER_SIZE,
			sampleRate,
			frameBudgetMs: FRAME_BUDGET_MS,
			longFrameLogIntervalMs: LONG_FRAME_LOG_INTERVAL_MS,
		});
		source.connect(processor);
		processor.connect(destination);
	} catch (error) {
		cleanupFailedNoiseSuppressionSetup({
			context,
			destinationStream: destination.stream,
			processor,
			source,
			sourceStream,
		});
		throw error;
	}

	if (!processor) {
		throw new Error("Noise suppression worklet processor was not created.");
	}
	const activeProcessor = processor;

	reportWarnings(selection, onWarning);

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
			activeProcessor.port.postMessage({ type: "destroy" });
			activeProcessor.disconnect();
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
		let settled = false;
		const readyTimeout = setTimeout(() => {
			settled = true;
			reject(new Error("Noise suppression worklet initialization timed out."));
		}, WORKLET_READY_TIMEOUT_MS);

		const settle = (
			callback: () => NoiseSuppressionWorkletReadySelection,
			complete: (selection: NoiseSuppressionWorkletReadySelection) => void,
		) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(readyTimeout);
			complete(callback());
		};

		processor.port.onmessage = (event) => {
			const message = event.data;
			if (message.type === "ready") {
				settle(
					() => ({
						requestedMode: message.requestedMode,
						activeMode: message.activeMode,
						warnings: message.warnings,
					}),
					resolve,
				);
				return;
			}
			if (message.type === "error") {
				if (!settled) {
					settled = true;
					clearTimeout(readyTimeout);
					reject(new Error(message.error));
				}
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

function cleanupFailedNoiseSuppressionSetup({
	context,
	destinationStream,
	processor,
	source,
	sourceStream,
}: {
	context: AudioContext;
	destinationStream: MediaStream;
	processor: AudioWorkletNode | null;
	source: MediaStreamAudioSourceNode;
	sourceStream: MediaStream;
}) {
	try {
		processor?.port.postMessage({ type: "destroy" });
	} catch {
		// Best effort: preserve the original setup error.
	}
	try {
		processor?.disconnect();
	} catch {
		// Best effort: preserve the original setup error.
	}
	try {
		source.disconnect();
	} catch {
		// Best effort: preserve the original setup error.
	}
	sourceStream.getTracks().forEach((track) => track.stop());
	destinationStream.getTracks().forEach((track) => track.stop());
	context.close().catch(() => undefined);
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
