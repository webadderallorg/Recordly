import { loadSpeexModule, SpeexPreprocessor } from "@sapphi-red/speex-preprocess-wasm";
import { Rnnoise } from "@shiguredo/rnnoise-wasm";

export type NoiseSuppressionMode = "rnnoise" | "speex" | "disabled";

export interface NoiseSuppressor {
	/**
	 * Allocates any native or WASM state needed before processing audio frames.
	 */
	initialize(): Promise<void>;
	/**
	 * Applies suppression to a single audio callback buffer.
	 */
	processAudioFrame(frame: Float32Array): Float32Array;
	/**
	 * Releases resources held by the suppressor.
	 */
	destroy(): void;
}

export type NoiseSuppressionSelection = {
	requestedMode: NoiseSuppressionMode;
	activeMode: NoiseSuppressionMode;
	suppressor: NoiseSuppressor;
	warnings: string[];
};

export const DEFAULT_NOISE_SUPPRESSION_MODE: NoiseSuppressionMode = "rnnoise";
export const NOISE_SUPPRESSION_MODES = new Set<NoiseSuppressionMode>([
	"rnnoise",
	"speex",
	"disabled",
]);

/**
 * Converts a persisted or user-provided value into a supported noise suppression mode.
 */
export function normalizeNoiseSuppressionMode(value?: string | null): NoiseSuppressionMode {
	const normalized = value?.trim().toLowerCase();
	return normalized && NOISE_SUPPRESSION_MODES.has(normalized as NoiseSuppressionMode)
		? (normalized as NoiseSuppressionMode)
		: DEFAULT_NOISE_SUPPRESSION_MODE;
}

/**
 * Pass-through suppressor used when microphone noise suppression is explicitly disabled.
 */
export class DisabledNoiseSuppressor implements NoiseSuppressor {
	/**
	 * Completes setup for the disabled suppressor.
	 */
	async initialize() {
		console.info("[NoiseSuppression] Disabled.");
	}

	/**
	 * Returns the input audio frame unchanged.
	 */
	processAudioFrame(frame: Float32Array) {
		return frame;
	}

	/**
	 * Releases the disabled suppressor lifecycle.
	 */
	destroy() {
		console.info("[NoiseSuppression] Disabled cleanup complete.");
	}
}

/**
 * Applies RNNoise denoising to microphone frames while preserving output timing.
 */
export class RnnoiseNoiseSuppressor implements NoiseSuppressor {
	private rnnoise: Awaited<ReturnType<typeof Rnnoise.load>> | null = null;
	private state: ReturnType<
		Awaited<ReturnType<typeof Rnnoise.load>>["createDenoiseState"]
	> | null = null;
	private remainder = new Float32Array(0);
	private queuedOutput = new Float32Array(0);

	/**
	 * Loads the RNNoise WASM module and creates a denoise state.
	 */
	async initialize() {
		console.info("[NoiseSuppression] Initializing RNNoise.");
		this.rnnoise = await Rnnoise.load();
		this.state = this.rnnoise.createDenoiseState();
		console.info("[NoiseSuppression] RNNoise initialized.", {
			frameSize: this.rnnoise.frameSize,
		});
	}

	/**
	 * Processes complete RNNoise frames and buffers partial input between callbacks.
	 */
	processAudioFrame(frame: Float32Array) {
		if (!this.rnnoise || !this.state) {
			throw new Error("RNNoise suppressor has not been initialized.");
		}

		const frameSize = this.rnnoise.frameSize;
		const pendingInput = new Float32Array(this.remainder.length + frame.length);
		pendingInput.set(this.remainder);
		pendingInput.set(frame, this.remainder.length);

		const completeLength = pendingInput.length - (pendingInput.length % frameSize);
		for (let offset = 0; offset < completeLength; offset += frameSize) {
			this.state.processFrame(pendingInput.subarray(offset, offset + frameSize));
		}

		this.remainder = pendingInput.slice(completeLength);
		this.queuedOutput = appendFloat32Arrays(
			this.queuedOutput,
			pendingInput.subarray(0, completeLength),
		);

		const output = new Float32Array(frame.length);
		const outputLength = Math.min(output.length, this.queuedOutput.length);
		if (outputLength > 0) {
			output.set(this.queuedOutput.subarray(0, outputLength));
			this.queuedOutput = this.queuedOutput.slice(outputLength);
		}
		return output;
	}

	/**
	 * Destroys RNNoise state and clears buffered audio.
	 */
	destroy() {
		this.state?.destroy();
		this.state = null;
		this.rnnoise = null;
		this.remainder = new Float32Array(0);
		this.queuedOutput = new Float32Array(0);
		console.info("[NoiseSuppression] RNNoise cleanup complete.");
	}
}

/**
 * Concatenates two Float32 buffers without mutating either source buffer.
 */
function appendFloat32Arrays(left: Float32Array, right: Float32Array) {
	if (left.length === 0) {
		return right.slice();
	}
	if (right.length === 0) {
		return left;
	}

	const combined = new Float32Array(left.length + right.length);
	combined.set(left);
	combined.set(right, left.length);
	return combined;
}

/**
 * Applies Speex preprocessor denoising to microphone frames.
 */
export class SpeexNoiseSuppressor implements NoiseSuppressor {
	private preprocessor: SpeexPreprocessor | null = null;

	constructor(
		private readonly frameSize: number,
		private readonly sampleRate: number,
	) {}

	/**
	 * Loads the Speex WASM module and configures denoise-only preprocessing.
	 */
	async initialize() {
		console.info("[NoiseSuppression] Initializing Speex.", {
			frameSize: this.frameSize,
			sampleRate: this.sampleRate,
		});
		const module = await loadSpeexModule();
		this.preprocessor = new SpeexPreprocessor(module, this.frameSize, this.sampleRate);
		this.preprocessor.denoise = true;
		this.preprocessor.noiseSuppress = -24;
		this.preprocessor.agc = false;
		this.preprocessor.vad = false;
		console.info("[NoiseSuppression] Speex initialized.");
	}

	/**
	 * Processes full Speex-sized chunks and leaves any incomplete trailing samples untouched.
	 */
	processAudioFrame(frame: Float32Array) {
		if (!this.preprocessor) {
			throw new Error("Speex suppressor has not been initialized.");
		}

		if (frame.length === this.frameSize) {
			this.preprocessor.process(frame);
			return frame;
		}

		for (let offset = 0; offset + this.frameSize <= frame.length; offset += this.frameSize) {
			this.preprocessor.process(frame.subarray(offset, offset + this.frameSize));
		}
		return frame;
	}

	/**
	 * Releases the Speex preprocessor instance.
	 */
	destroy() {
		this.preprocessor?.destroy();
		this.preprocessor = null;
		console.info("[NoiseSuppression] Speex cleanup complete.");
	}
}

export type NoiseSuppressorFactoryDeps = {
	createRnnoise?: () => NoiseSuppressor;
	createSpeex?: () => NoiseSuppressor;
	createDisabled?: () => NoiseSuppressor;
};

/**
 * Initializes the requested suppressor and falls back to compatible alternatives when needed.
 */
export async function createNoiseSuppressorWithFallback({
	mode,
	frameSize,
	sampleRate,
	deps = {},
}: {
	mode: NoiseSuppressionMode;
	frameSize: number;
	sampleRate: number;
	deps?: NoiseSuppressorFactoryDeps;
}): Promise<NoiseSuppressionSelection> {
	const warnings: string[] = [];
	const createDisabled = deps.createDisabled ?? (() => new DisabledNoiseSuppressor());
	const candidates: NoiseSuppressionMode[] =
		mode === "disabled" ? ["disabled"] : mode === "rnnoise" ? ["rnnoise", "speex"] : ["speex"];

	for (const candidate of candidates) {
		const suppressor =
			candidate === "rnnoise"
				? (deps.createRnnoise?.() ?? new RnnoiseNoiseSuppressor())
				: candidate === "speex"
					? (deps.createSpeex?.() ?? new SpeexNoiseSuppressor(frameSize, sampleRate))
					: createDisabled();
		try {
			await suppressor.initialize();
			if (candidate !== mode) {
				console.warn("[NoiseSuppression] Falling back.", {
					requestedMode: mode,
					activeMode: candidate,
				});
			}
			return {
				requestedMode: mode,
				activeMode: candidate,
				suppressor,
				warnings,
			};
		} catch (error) {
			suppressor.destroy();
			const warning = `Failed to initialize ${candidate}: ${
				error instanceof Error ? error.message : String(error)
			}`;
			warnings.push(warning);
			console.warn("[NoiseSuppression]", warning);
		}
	}

	const suppressor = createDisabled();
	await suppressor.initialize();
	console.warn("[NoiseSuppression] All algorithms failed; recording without noise suppression.");
	return {
		requestedMode: mode,
		activeMode: "disabled",
		suppressor,
		warnings,
	};
}
