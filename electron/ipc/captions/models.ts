import path from "node:path";
import { app } from "electron";
import { existsSync } from "node:fs";

/**
 * Model engine type.
 * - "whisper": whisper.cpp subprocess (GGML models)
 * - "sensevoice": sherpa-onnx (ONNX models)
 */
export type ModelEngine = "whisper" | "sensevoice";

export interface CaptionModel {
	/** Unique model identifier, e.g. "whisper-large-v3" */
	id: string;
	/** Display name shown in the UI */
	name: string;
	/** Engine that runs this model */
	engine: ModelEngine;
	/** Primary download URL (HuggingFace / ModelScope mirror) */
	downloadUrl: string;
	/** File name stored under the model directory */
	fileName: string;
	/** For multi-file models (SenseVoice ONNX), additional files to download */
	auxiliaryFiles?: Array<{ url: string; fileName: string }>;
	/** Approximate download size in bytes (for UI display) */
	sizeBytes?: number;
	/** Human-readable size label, e.g. "~3 GB" */
	sizeLabel?: string;
	/** Languages this model excels at */
	languages: string[];
	/** Short description shown in the model picker */
	description: string;
	/** If true, pre-selected as the default model */
	isDefault?: boolean;
}

const HF_BASE = "https://hf-mirror.com";
const WHISPER_REPO = "ggerganov/whisper.cpp";

function hfUrl(repo: string, file: string): string {
	return `${HF_BASE}/${repo}/resolve/main/${file}`;
}

/**
 * All available caption models.
 * Models are grouped by engine and sorted by quality (best first).
 */
export const CAPTION_MODELS: CaptionModel[] = [
	// ── SenseVoice (通义 FunASR via sherpa-onnx) — best for Chinese ──
	{
		id: "sensevoice-small",
		name: "SenseVoice Small (通义·int8)",
		engine: "sensevoice",
		downloadUrl:
			"https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx",
		auxiliaryFiles: [
			{
				url: "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt",
				fileName: "tokens.txt",
			},
		],
		fileName: "model.int8.onnx",
		sizeBytes: 239_233_841,
		sizeLabel: "~239 MB",
		languages: ["zh", "en", "ja", "ko", "yue", "auto"],
		description: "阿里通义 SenseVoice (int8)，中文识别最佳，速度快",
		isDefault: true,
	},
	{
		id: "sensevoice-small-fp32",
		name: "SenseVoice Small (通义·完整版)",
		engine: "sensevoice",
		downloadUrl:
			"https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.onnx",
		auxiliaryFiles: [
			{
				url: "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt",
				fileName: "tokens.txt",
			},
		],
		fileName: "model.onnx",
		sizeBytes: 937_617_178,
		sizeLabel: "~937 MB",
		languages: ["zh", "en", "ja", "ko", "yue", "auto"],
		description: "阿里通义 SenseVoice (FP32)，最高精度",
	},

	// ── Whisper (whisper.cpp) ──
	{
		id: "whisper-large-v3",
		name: "Whisper Large V3",
		engine: "whisper",
		downloadUrl: hfUrl(WHISPER_REPO, "ggml-large-v3.bin"),
		fileName: "ggml-large-v3.bin",
		sizeBytes: 3_095_000_000,
		sizeLabel: "~3 GB",
		languages: ["auto", "zh", "en", "ja", "ko"],
		description: "OpenAI Whisper，多语言效果最好",
	},
	{
		id: "whisper-large-v3-turbo",
		name: "Whisper Large V3 Turbo",
		engine: "whisper",
		downloadUrl: hfUrl(WHISPER_REPO, "ggml-large-v3-turbo.bin"),
		fileName: "ggml-large-v3-turbo.bin",
		sizeBytes: 1_543_000_000,
		sizeLabel: "~1.5 GB",
		languages: ["auto", "zh", "en", "ja", "ko"],
		description: "Whisper 加速版，速度快质量高",
	},
	{
		id: "whisper-medium",
		name: "Whisper Medium",
		engine: "whisper",
		downloadUrl: hfUrl(WHISPER_REPO, "ggml-medium.bin"),
		fileName: "ggml-medium.bin",
		sizeBytes: 1_533_000_000,
		sizeLabel: "~1.5 GB",
		languages: ["auto", "zh", "en", "ja", "ko"],
		description: "Whisper 中等模型，平衡速度与质量",
	},
	{
		id: "whisper-small",
		name: "Whisper Small",
		engine: "whisper",
		downloadUrl: hfUrl(WHISPER_REPO, "ggml-small.bin"),
		fileName: "ggml-small.bin",
		sizeBytes: 466_000_000,
		sizeLabel: "~466 MB",
		languages: ["auto", "zh", "en"],
		description: "Whisper 小模型，下载快",
	},
	{
		id: "whisper-base",
		name: "Whisper Base",
		engine: "whisper",
		downloadUrl: hfUrl(WHISPER_REPO, "ggml-base.bin"),
		fileName: "ggml-base.bin",
		sizeBytes: 147_000_000,
		sizeLabel: "~147 MB",
		languages: ["auto", "en"],
		description: "Whisper 基础模型，体积最小",
	},
];

/** Default model ID — SenseVoice for best Chinese support */
export const DEFAULT_MODEL_ID = "sensevoice-small";

/**
 * Resolve the bundled (pre-installed) storage directory for a given model.
 * In development: <project>/models/<model-id>/
 * In production: <app-resources>/assets/models/<model-id>/
 */
export function getBundledModelDir(model: CaptionModel): string {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, "assets", "models", model.id);
	}
	// In dev, models/ sits at the project root
	return path.join(__dirname, "..", "models", model.id);
}

/**
 * Check if the model exists in the bundled (pre-installed) location.
 */
export function bundledModelExists(model: CaptionModel): boolean {
	const dir = getBundledModelDir(model);
	const filePath = path.join(dir, model.fileName);
	return existsSync(filePath);
}

/**
 * Resolve the local storage directory for a given model.
 * All models live under <userData>/models/<model-id>/
 */
export function getModelStorageDir(model: CaptionModel, userDataPath: string): string {
	return path.join(userDataPath, "models", model.id);
}

/**
 * Resolve the primary model file path on disk.
 * Checks bundled path first, then user-data download path.
 */
export function getModelFilePath(model: CaptionModel, userDataPath: string): string {
	// Prefer bundled model
	const bundledDir = getBundledModelDir(model);
	const bundledPath = path.join(bundledDir, model.fileName);
	if (existsSync(bundledPath)) {
		return bundledPath;
	}
	// Fall back to user-data download
	return path.join(getModelStorageDir(model, userDataPath), model.fileName);
}

/**
 * Resolve the storage directory — returns bundled dir if it exists, else user-data dir.
 */
export function getModelDir(model: CaptionModel, userDataPath: string): string {
	const bundledDir = getBundledModelDir(model);
	if (existsSync(bundledDir)) {
		return bundledDir;
	}
	return getModelStorageDir(model, userDataPath);
}

/**
 * Look up a model by its ID.
 */
export function getModelById(id: string): CaptionModel | undefined {
	return CAPTION_MODELS.find((m) => m.id === id);
}

/**
 * Get the default model.
 */
export function getDefaultModel(): CaptionModel {
	return CAPTION_MODELS.find((m) => m.id === DEFAULT_MODEL_ID) ?? CAPTION_MODELS[0];
}
