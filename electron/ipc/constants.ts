import path from "node:path";
import { USER_DATA_PATH } from "../appPaths";

export const PROJECT_FILE_EXTENSION = "recordly";
export const LEGACY_PROJECT_FILE_EXTENSIONS = ["openscreen"];
export const PROJECTS_DIRECTORY_NAME = "Projects";
export const PROJECT_THUMBNAIL_SUFFIX = ".preview.png";
export const RECENT_PROJECTS_FILE = path.join(USER_DATA_PATH, "recent-projects.json");
export const MAX_RECENT_PROJECTS = 16;
export const SHORTCUTS_FILE = path.join(USER_DATA_PATH, "shortcuts.json");
export const RECORDINGS_SETTINGS_FILE = path.join(USER_DATA_PATH, "recordings-settings.json");
export const COUNTDOWN_SETTINGS_FILE = path.join(USER_DATA_PATH, "countdown-settings.json");
export const APP_SETTINGS_FILE = path.join(USER_DATA_PATH, "app-settings.json");
export const AUTO_RECORDING_PREFIX = "recording-";
export const AUTO_RECORDING_RETENTION_COUNT = 20;
export const AUTO_RECORDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const ALLOW_RECORDLY_WINDOW_CAPTURE = Boolean(process.env["VITE_DEV_SERVER_URL"]);
export const RECORDING_SESSION_MANIFEST_SUFFIX = ".recordly-session.json";
export const WHISPER_MODEL_DOWNLOAD_URL =
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
export const WHISPER_MODEL_DIR = path.join(USER_DATA_PATH, "whisper");
export const WHISPER_SMALL_MODEL_PATH = path.join(WHISPER_MODEL_DIR, "ggml-small.bin");
export const PARAKEET_MODEL_DOWNLOAD_BASE_URL =
	"https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78";
export const PARAKEET_MODEL_DIR = path.join(USER_DATA_PATH, "parakeet");
export const PARAKEET_MODEL_FILES = [
	"encoder.int8.onnx",
	"decoder.int8.onnx",
	"joiner.int8.onnx",
	"tokens.txt",
] as const;

export type ParakeetModelFileName = (typeof PARAKEET_MODEL_FILES)[number];

export interface FileVerificationMetadata {
	expectedSize: number;
	expectedSha256: string;
}

export const PARAKEET_MODEL_FILE_METADATA: Record<ParakeetModelFileName, FileVerificationMetadata> =
	{
		"encoder.int8.onnx": {
			expectedSize: 652184281,
			expectedSha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
		},
		"decoder.int8.onnx": {
			expectedSize: 11845275,
			expectedSha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
		},
		"joiner.int8.onnx": {
			expectedSize: 6355277,
			expectedSha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
		},
		"tokens.txt": {
			expectedSize: 93939,
			expectedSha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
		},
	};

export const SHERPA_ONNX_RELEASE_VERSION = "v1.13.7";
export const SHERPA_ONNX_RELEASE_BASE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_ONNX_RELEASE_VERSION}`;

export interface SherpaOnnxBinaryAsset {
	archiveName: string;
	url: string;
	binaryName: string;
	extractedSubdir: string;
	expectedSize: number;
	expectedSha256: string;
}

export const SHERPA_ONNX_RUNTIME_ASSETS: Record<string, SherpaOnnxBinaryAsset> = {
	"win32-x64": {
		archiveName: "sherpa-onnx-v1.13.7-win-x64-shared-MT-Release.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-win-x64-shared-MT-Release.tar.bz2`,
		binaryName: "sherpa-onnx-offline.exe",
		extractedSubdir: "sherpa-onnx-v1.13.7-win-x64-shared-MT-Release",
		expectedSize: 24500658,
		expectedSha256: "0b8f4a8cdde53cee671b0647947c66e10efec1b63ed2606c8eeac650071c9c60",
	},
	"win32-arm64": {
		archiveName: "sherpa-onnx-v1.13.7-win-arm64-shared-MT-Release.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-win-arm64-shared-MT-Release.tar.bz2`,
		binaryName: "sherpa-onnx-offline.exe",
		extractedSubdir: "sherpa-onnx-v1.13.7-win-arm64-shared-MT-Release",
		expectedSize: 22958354,
		expectedSha256: "cc8a0b1385efea48161dc63bc20b22c67ba719edb2650f4eda0e92675c3bef51",
	},
	"darwin-x64": {
		archiveName: "sherpa-onnx-v1.13.7-osx-universal2-shared.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-osx-universal2-shared.tar.bz2`,
		binaryName: "sherpa-onnx-offline",
		extractedSubdir: "sherpa-onnx-v1.13.7-osx-universal2-shared",
		expectedSize: 43312926,
		expectedSha256: "a486bb987f9ccff182768bf75c39e81c2d3e4ba7143368e9e00139becc441cb5",
	},
	"darwin-arm64": {
		archiveName: "sherpa-onnx-v1.13.7-osx-universal2-shared.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-osx-universal2-shared.tar.bz2`,
		binaryName: "sherpa-onnx-offline",
		extractedSubdir: "sherpa-onnx-v1.13.7-osx-universal2-shared",
		expectedSize: 43312926,
		expectedSha256: "a486bb987f9ccff182768bf75c39e81c2d3e4ba7143368e9e00139becc441cb5",
	},
	"linux-x64": {
		archiveName: "sherpa-onnx-v1.13.7-linux-x64-shared.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-linux-x64-shared.tar.bz2`,
		binaryName: "sherpa-onnx-offline",
		extractedSubdir: "sherpa-onnx-v1.13.7-linux-x64-shared",
		expectedSize: 27884774,
		expectedSha256: "95b9f4358e2d5522a0bd987c3ee91128e31f8abf4340927cab32e438300f3c24",
	},
	"linux-arm64": {
		archiveName: "sherpa-onnx-v1.13.7-linux-aarch64-shared-cpu.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-linux-aarch64-shared-cpu.tar.bz2`,
		binaryName: "sherpa-onnx-offline",
		extractedSubdir: "sherpa-onnx-v1.13.7-linux-aarch64-shared-cpu",
		expectedSize: 27755388,
		expectedSha256: "7ab34c29ad9927e772f32be43efddd5e971987dc59e5f9aa3c09513348e4505b",
	},
};

export const SHERPA_ONNX_RUNTIME_DIR = path.join(USER_DATA_PATH, "runtime", "sherpa-onnx");
export const COMPANION_AUDIO_LAYOUTS = [
	{ platform: "mac" as const, systemSuffix: ".system.m4a", micSuffix: ".mic.m4a" },
	{ platform: "win" as const, systemSuffix: ".system.wav", micSuffix: ".mic.wav" },
	{ platform: "mac" as const, systemSuffix: ".system.webm", micSuffix: ".mic.webm" },
];

export const CURSOR_TELEMETRY_VERSION = 2;
export const CURSOR_SAMPLE_INTERVAL_MS = 33;
export const MAX_CURSOR_SAMPLES = 60 * 60 * 30; // 1 hour @ 30Hz
