import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import {
	AUTO_ZOOM_RECORDING_LIMIT,
	type FirstRecordingAutoZooms,
	normalizeFirstRecordingAutoZooms,
} from "../../../src/shared/firstRecordingAutoZooms";
import { USER_DATA_PATH } from "../../appPaths";

/** A separate locked ledger avoids races with other instances and unrelated preferences. */
export function createFirstRecordingAutoZoomStore(file: string) {
	async function transaction(
		change: (state: FirstRecordingAutoZooms) => boolean,
	): Promise<boolean> {
		await fs.mkdir(path.dirname(file), { recursive: true });
		const release = await lockfile.lock(file, {
			realpath: false,
			retries: { retries: 12, minTimeout: 30, maxTimeout: 150 },
			stale: 10000,
		});
		try {
			let state: FirstRecordingAutoZooms;
			try {
				state = normalizeFirstRecordingAutoZooms(
					JSON.parse(await fs.readFile(file, "utf8")),
				);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				state = { recordings: [], handled: [] };
			}
			if (!change(state)) return false;
			const temporary = `${file}.${randomUUID()}.tmp`;
			try {
				const handle = await fs.open(temporary, "wx", 0o600);
				try {
					await handle.writeFile(JSON.stringify(state), "utf8");
					await handle.sync();
				} finally {
					await handle.close();
				}
				await fs.rename(temporary, file);
			} finally {
				await fs.rm(temporary, { force: true });
			}
			return true;
		} finally {
			await release();
		}
	}
	return {
		register: (videoPath: string) =>
			transaction((state) => {
				if (
					state.recordings.includes(videoPath) ||
					state.recordings.length >= AUTO_ZOOM_RECORDING_LIMIT
				)
					return false;
				state.recordings.push(videoPath);
				return true;
			}),
		claim: (videoPath: string) =>
			transaction((state) => {
				if (!state.recordings.includes(videoPath) || state.handled.includes(videoPath))
					return false;
				state.handled.push(videoPath);
				return true;
			}),
	};
}
const store = createFirstRecordingAutoZoomStore(
	path.join(USER_DATA_PATH, "first-recording-auto-zooms-v1.json"),
);

/** Only validated captures call this; imports and failed captures never consume a slot. */
export async function registerFirstRecordingAutoZooms(videoPath: string) {
	try {
		await store.register(videoPath);
	} catch (error) {
		console.warn("Could not register automatic zooms for the recording:", error);
	}
}

export async function claimFirstRecordingAutoZooms(videoPath: string) {
	try {
		return await store.claim(videoPath);
	} catch (error) {
		console.warn("Could not claim automatic zooms for the recording:", error);
		return false;
	}
}
