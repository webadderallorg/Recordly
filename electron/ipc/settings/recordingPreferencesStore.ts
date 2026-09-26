import fs from "node:fs/promises";
import path from "node:path";
import { parseJsonWithByteOrderMark } from "../utils";

export interface RecordingPreferencesPatch {
	microphoneEnabled?: boolean;
	microphoneDeviceId?: string;
	systemAudioEnabled?: boolean;
	webcamEnabled?: boolean;
	webcamDeviceId?: string;
	recordingsDir?: string;
}

// All users of the settings file share a queue, including the library directory picker.
const operationQueues = new Map<string, Promise<void>>();

export function createRecordingPreferencesStore(filePath: string) {
	const queueKey = path.resolve(filePath);

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
			await operationQueues.get(queueKey);
			return readFile();
		},
		async update(patch: RecordingPreferencesPatch): Promise<void> {
			const operation = (operationQueues.get(queueKey) ?? Promise.resolve()).then(async () => {
				const existing = await readFile();
				await fs.writeFile(
					filePath,
					JSON.stringify({ ...existing, ...patch }, null, 2),
					"utf-8",
				);
			});
			const settled = operation.catch(() => undefined);
			operationQueues.set(queueKey, settled);
			void settled.then(() => {
				if (operationQueues.get(queueKey) === settled) operationQueues.delete(queueKey);
			});
			await operation;
		},
	};
}
