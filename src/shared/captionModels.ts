export const CAPTION_MODELS = [
	{
		id: "parakeet-v3",
		label: "Parakeet v3",
		engine: "parakeet",
		downloadBytes: 670478772,
		languageDescription: "25 European languages",
		wordTimestamps: true,
	},
	{
		id: "whisper-base",
		label: "Whisper Base",
		engine: "whisper",
		downloadBytes: 147951465,
		languageDescription: "Multilingual · 99 languages",
		wordTimestamps: true,
	},
	{
		id: "whisper-small",
		label: "Whisper Small",
		engine: "whisper",
		downloadBytes: 487601967,
		languageDescription: "Multilingual · 99 languages",
		wordTimestamps: true,
	},
] as const;

export type CaptionModelId = (typeof CAPTION_MODELS)[number]["id"];
export type CaptionModelDownloadProgress = {
	modelId: CaptionModelId;
	status: "idle" | "downloading" | "downloaded" | "error";
	progress: number;
	path?: string | null;
	error?: string;
};

export function isCaptionModelId(value: unknown): value is CaptionModelId {
	return CAPTION_MODELS.some((model) => model.id === value);
}

export function getCaptionModel(id: CaptionModelId) {
	return CAPTION_MODELS.find((model) => model.id === id)!;
}
