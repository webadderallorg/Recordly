interface ElectronAPIExport {
	storeRecordedVideo: (
		videoData: ArrayBuffer,
		fileName: string,
	) => Promise<{ success: boolean; path?: string; message?: string }>;
	storeMicrophoneSidecar: (
		audioData: ArrayBuffer,
		videoPath: string,
	) => Promise<{ success: boolean; path?: string; error?: string }>;
	getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>;
	listAssetDirectory: (relativeDir: string) => Promise<{
		success: boolean;
		files?: string[];
		error?: string;
	}>;
	readLocalFile: (filePath: string) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
	generateWallpaperThumbnail: (
		filePath: string,
	) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
	nativeVideoExportStart: (options: {
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		encodingMode: "fast" | "balanced" | "quality";
		inputMode?: "rawvideo" | "h264-stream";
	}) => Promise<{
		success: boolean;
		sessionId?: string;
		encoderName?: string;
		error?: string;
	}>;
	nativeVideoExportWriteFrame: (
		sessionId: string,
		frameData: Uint8Array,
	) => Promise<{ success: boolean; error?: string }>;
	nativeVideoExportFinish: (
		sessionId: string,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		},
	) => Promise<{
		success: boolean;
		data?: Uint8Array;
		encoderName?: string;
		error?: string;
	}>;
	nativeVideoExportCancel: (
		sessionId: string,
	) => Promise<{ success: boolean; error?: string }>;
	muxExportedVideoAudio: (
		videoData: ArrayBuffer,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		},
	) => Promise<{
		success: boolean;
		data?: Uint8Array;
		error?: string;
	}>;
	getVideoAudioFallbackPaths: (
		videoPath: string,
	) => Promise<{ success: boolean; paths: string[]; error?: string }>;
	saveExportedVideo: (
		videoData: ArrayBuffer,
		fileName: string,
	) => Promise<{ success: boolean; path?: string; message?: string; canceled?: boolean }>;
	writeExportedVideoToPath: (
		videoData: ArrayBuffer,
		outputPath: string,
	) => Promise<{
		success: boolean;
		path?: string;
		message?: string;
		error?: string;
		canceled?: boolean;
	}>;
	openVideoFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
	openAudioFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
	openWhisperExecutablePicker: () => Promise<{
		success: boolean;
		path?: string;
		canceled?: boolean;
		error?: string;
	}>;
	openWhisperModelPicker: () => Promise<{
		success: boolean;
		path?: string;
		canceled?: boolean;
		error?: string;
	}>;
	getWhisperSmallModelStatus: () => Promise<{
		success: boolean;
		exists: boolean;
		path?: string | null;
		error?: string;
	}>;
	downloadWhisperSmallModel: () => Promise<{
		success: boolean;
		path?: string;
		alreadyDownloaded?: boolean;
		error?: string;
	}>;
	deleteWhisperSmallModel: () => Promise<{ success: boolean; error?: string }>;
	onWhisperSmallModelDownloadProgress: (
		callback: (state: {
			status: "idle" | "downloading" | "downloaded" | "error";
			progress: number;
			path?: string | null;
			error?: string;
		}) => void,
	) => () => void;
	generateAutoCaptions: (options: {
		videoPath: string;
		whisperExecutablePath?: string;
		whisperModelPath: string;
		language?: string;
	}) => Promise<{
		success: boolean;
		cues?: AutoCaptionCue[];
		message?: string;
		error?: string;
	}>;
}