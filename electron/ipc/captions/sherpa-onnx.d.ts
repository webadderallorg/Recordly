declare module "sherpa-onnx" {
	interface FeatConfig {
		sampleRate: number;
		featureDim: number;
	}

	interface SenseVoiceModelConfig {
		model: string;
		language: string;
		useInverseTextNormalization?: number;
	}

	interface OfflineModelConfig {
		senseVoice: SenseVoiceModelConfig;
		tokens: string;
	}

	interface OfflineRecognizerConfig {
		featConfig: FeatConfig;
		modelConfig: OfflineModelConfig;
		lmConfig?: { model?: string; scale?: number };
		decodingMethod?: string;
		maxActivePaths?: number;
		hotwordsFile?: string;
		hotwordsScore?: number;
	}

	interface WaveData {
		sampleRate: number;
		samples: Float32Array;
	}

	interface OfflineSegment {
		text: string;
		start: number;
		end: number;
	}

	interface OfflineResult {
		text?: string;
		segments?: OfflineSegment[];
	}

	interface OfflineStream {
		acceptWaveform(sampleRate: number, samples: Float32Array): void;
		free(): void;
	}

	interface OfflineRecognizer {
		createStream(): OfflineStream;
		decode(stream: OfflineStream): void;
		getResult(stream: OfflineStream): OfflineResult;
		free(): void;
	}

	export function createOfflineRecognizer(config: OfflineRecognizerConfig): OfflineRecognizer;
	export function readWave(path: string): WaveData;
	export function readWaveFromBinaryData(data: ArrayBuffer): WaveData;

	export const version: string;
}
