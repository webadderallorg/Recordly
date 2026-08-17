import type { CaptionModel } from "./models";

/**
 * Result from caption generation.
 */
export interface CaptionWordPayload {
	text: string;
	startMs: number;
	endMs: number;
}

export interface CaptionCuePayload {
	id: string;
	text: string;
	startMs: number;
	endMs: number;
	words?: CaptionWordPayload[];
}

export interface GenerateCaptionResult {
	success: boolean;
	cues: CaptionCuePayload[];
	message?: string;
	error?: string;
}

/**
 * Options passed to an engine for caption generation.
 */
export interface GenerateCaptionOptions {
	/** Path to the pre-extracted 16kHz mono WAV file */
	audioPath: string;
	/** Absolute path to the downloaded model file */
	modelPath: string;
	/** The model metadata */
	model: CaptionModel;
	/** Language hint (BCP-47 code or "auto") */
	language?: string;
	/** Temp directory for intermediate files */
	tempDir: string;
}

/**
 * Abstract engine interface.
 * Each engine (whisper, sensevoice) implements this.
 */
export interface CaptionEngine {
	readonly engineType: string;

	/**
	 * Run caption generation.
	 * Receives fully resolved paths — no model resolution needed.
	 */
	generate(options: GenerateCaptionOptions): Promise<GenerateCaptionResult>;
}
