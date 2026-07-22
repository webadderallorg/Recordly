import { Rnnoise } from "@shiguredo/rnnoise-wasm";
import { loadSpeexModule, SpeexPreprocessor } from "@sapphi-red/speex-preprocess-wasm";

export type NoiseSuppressionMode = "rnnoise" | "speex" | "disabled";

export interface NoiseSuppressor {
	initialize(): Promise<void>;
	processAudioFrame(frame: Float32Array): Float32Array;
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

export function normalizeNoiseSuppressionMode(value?: string | null): NoiseSuppressionMode {
	const normalized = value?.trim().toLowerCase();
	return normalized && NOISE_SUPPRESSION_MODES.has(normalized as NoiseSuppressionMode)
		? (normalized as NoiseSuppressionMode)
		: DEFAULT_NOISE_SUPPRESSION_MODE;
}

export class DisabledNoiseSuppressor implements NoiseSuppressor {
	async initialize() {
		console.info("[NoiseSuppression] Disabled.");
	}

	processAudioFrame(frame: Float32Array) {
		return frame;
	}

	destroy() {
		console.info("[NoiseSuppression] Disabled cleanup complete.");
	}
}

export class RnnoiseNoiseSuppressor implements NoiseSuppressor {
	private rnnoise: Awaited<ReturnType<typeof Rnnoise.load>> | null = null;
	private state: ReturnType<
		Awaited<ReturnType<typeof Rnnoise.load>>["createDenoiseState"]
	> | null = null;

	async initialize() {
		console.info("[NoiseSuppression] Initializing RNNoise.");
		this.rnnoise = await Rnnoise.load();
		this.state = this.rnnoise.createDenoiseState();
		console.info("[NoiseSuppression] RNNoise initialized.", {
			frameSize: this.rnnoise.frameSize,
		});
	}

	processAudioFrame(frame: Float32Array) {
		if (!this.rnnoise || !this.state) {
			throw new Error("RNNoise suppressor has not been initialized.");
		}

		const frameSize = this.rnnoise.frameSize;
		if (frame.length === frameSize) {
			this.state.processFrame(frame);
			return frame;
		}

		if (frame.length < frameSize) {
			return frame;
		}

		for (let offset = 0; offset + frameSize <= frame.length; offset += frameSize) {
			this.state.processFrame(frame.subarray(offset, offset + frameSize));
		}
		return frame;
	}

	destroy() {
		this.state?.destroy();
		this.state = null;
		this.rnnoise = null;
		console.info("[NoiseSuppression] RNNoise cleanup complete.");
	}
}

export class SpeexNoiseSuppressor implements NoiseSuppressor {
	private preprocessor: SpeexPreprocessor | null = null;

	constructor(
		private readonly frameSize: number,
		private readonly sampleRate: number,
	) {}

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
