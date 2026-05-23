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
export const COMPANION_AUDIO_LAYOUTS = [
	{ platform: "mac" as const, systemSuffix: ".system.m4a", micSuffix: ".mic.m4a" },
	{ platform: "win" as const, systemSuffix: ".system.wav", micSuffix: ".mic.wav" },
	{ platform: "mac" as const, systemSuffix: ".system.webm", micSuffix: ".mic.webm" },
];

export const CURSOR_TELEMETRY_VERSION = 2;
export const CURSOR_SAMPLE_INTERVAL_MS = 33;
export const MAX_CURSOR_SAMPLES = 60 * 60 * 30; // 1 hour @ 30Hz
