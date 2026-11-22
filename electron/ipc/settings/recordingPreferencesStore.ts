import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { RECORDINGS_SETTINGS_FILE } from "../constants";
import { parseJsonWithByteOrderMark } from "../utils";

export interface RecordingPreferencesPatch {
	microphoneEnabled?: boolean;
	microphoneDeviceId?: string;
	systemAudioEnabled?: boolean;
	webcamEnabled?: boolean;
	webcamDeviceId?: string;
	floatingWebcamPreviewVisible?: boolean;
}

type RecordingSettingsPatch = RecordingPreferencesPatch & { recordingsDir?: string };

export function createRecordingPreferencesStore(filePath: string) {
	let operationQueue: Promise<void> = Promise.resolve();

	const readFile = async (): Promise<Record<string, unknown>> => {
		try {
			const content = await fs.readFile(filePath, "utf-8");
			const parsed = parseJsonWithByteOrderMark<unknown>(content);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	};

	return {
		async read(): Promise<Record<string, unknown>> {
			await operationQueue;
			return readFile();
		},
		async update(patch: RecordingSettingsPatch): Promise<void> {
			const operation = operationQueue.then(async () => {
				const existing = await readFile();
				const temporary = `${filePath}.${randomUUID()}.tmp`;
				try {
					await fs.writeFile(
						temporary,
						JSON.stringify({ ...existing, ...patch }, null, 2),
						{
							encoding: "utf-8",
							flag: "wx",
							mode: 0o600,
						},
					);
					await fs.rename(temporary, filePath);
				} finally {
					await fs.rm(temporary, { force: true }).catch(() => undefined);
				}
			});
			operationQueue = operation.catch(() => undefined);
			await operation;
		},
	};
}

export const recordingPreferencesStore = createRecordingPreferencesStore(RECORDINGS_SETTINGS_FILE);
