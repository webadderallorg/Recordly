import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { lockSync } from "proper-lockfile";

const STALE_MS = 30_000;

function hasLiveOwner(ownerPath: string): boolean {
	try {
		const pid: unknown = JSON.parse(readFileSync(ownerPath, "utf8")).pid;
		if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return false;
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code !== "ESRCH";
		}
	} catch {
		return false;
	}
}

/**
 * On Windows, Electron's safeStorage key lives in each Chromium profile's
 * "Local State" (`os_crypt.encrypted_key`, itself DPAPI-protected for the
 * current Windows user). Additional instances use separate profiles, so without
 * this they generate their own key and cannot decrypt the shared auth store or
 * sign-in routing records written by the primary instance. Copy the primary
 * profile's key into an additional profile before Chromium starts. macOS and
 * Linux keep one app-wide key in the system keychain, so they need nothing.
 */
export type ShareSafeStorageKeyResult = "primary" | "no-primary-key" | "unchanged" | "shared";

/** Keys this profile used before adopting the primary key; kept so nothing is lost for good. */
export const REPLACED_KEYS_FILE = "recordly-replaced-safe-storage-keys.json";

function readPrimaryKey(primarySessionPath: string): string | null {
	try {
		const key: unknown = JSON.parse(
			readFileSync(path.join(primarySessionPath, "Local State"), "utf8"),
		)?.os_crypt?.encrypted_key;
		return typeof key === "string" && key ? key : null;
	} catch {
		return null;
	}
}

export function shareSafeStorageKey(
	primarySessionPath: string,
	sessionPath: string,
): ShareSafeStorageKeyResult {
	if (path.resolve(primarySessionPath) === path.resolve(sessionPath)) return "primary";
	const primaryKey = readPrimaryKey(primarySessionPath);
	if (!primaryKey) return "no-primary-key";
	const localStatePath = path.join(sessionPath, "Local State");
	let state: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(localStatePath, "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
			state = parsed as Record<string, unknown>;
	} catch {
		// Missing or unreadable: Chromium recreates the remaining fields.
	}
	const osCrypt =
		state.os_crypt && typeof state.os_crypt === "object"
			? (state.os_crypt as Record<string, unknown>)
			: {};
	if (osCrypt.encrypted_key === primaryKey) return "unchanged";
	// Anything this profile encrypted under its own key cannot be re-encrypted
	// here (safeStorage holds one key per process). Keep the replaced key next to
	// the profile instead of discarding it, so that data stays recoverable.
	if (typeof osCrypt.encrypted_key === "string" && osCrypt.encrypted_key) {
		const backupPath = path.join(sessionPath, REPLACED_KEYS_FILE);
		let replaced: string[] = [];
		let raw: string | null = null;
		try {
			raw = readFileSync(backupPath, "utf8");
		} catch (error) {
			// Only a missing backup counts as empty history; anything else must not
			// overwrite keys kept earlier, so leave both files untouched.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (raw !== null) {
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed) || parsed.some((key) => typeof key !== "string"))
				throw new Error(
					`Unexpected contents in ${REPLACED_KEYS_FILE}; keeping this profile's key.`,
				);
			replaced = parsed;
		}
		if (!replaced.includes(osCrypt.encrypted_key)) replaced.push(osCrypt.encrypted_key);
		writeFileSync(backupPath, JSON.stringify(replaced), { mode: 0o600 });
	}
	state.os_crypt = { ...osCrypt, encrypted_key: primaryKey };
	writeFileSync(localStatePath, JSON.stringify(state), { mode: 0o600 });
	return "shared";
}

function sleepSync(ms: number) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A secondary instance can start before a brand-new primary profile has
 * written its key. Wait briefly for it rather than letting the secondary create
 * a separate key that a later launch would replace.
 */
export function shareSafeStorageKeyWhenReady(
	primarySessionPath: string,
	sessionPath: string,
	{ timeoutMs = 10_000, intervalMs = 100, sleep = sleepSync } = {},
): ShareSafeStorageKeyResult {
	let result = shareSafeStorageKey(primarySessionPath, sessionPath);
	for (let waited = 0; result === "no-primary-key" && waited < timeoutMs; waited += intervalMs) {
		sleep(intervalMs);
		result = shareSafeStorageKey(primarySessionPath, sessionPath);
	}
	return result;
}

/** Reserve durable Chromium storage without opening another process's profile. */
export function reserveInstanceSession(userDataPath: string, primarySessionPath: string) {
	const sessionsPath = path.join(userDataPath, "instance-sessions");
	const locksPath = path.join(sessionsPath, ".locks");
	mkdirSync(locksPath, { recursive: true });
	for (let slot = 0; slot < 128; slot++) {
		const name = slot === 0 ? "primary" : `slot-${slot}`;
		const sessionPath = slot === 0 ? primarySessionPath : path.join(sessionsPath, name);
		const lockfilePath = path.join(locksPath, `${name}.lock`);
		const ownerPath = path.join(locksPath, `${name}.owner.json`);
		// A sleeping Mac pauses heartbeats. Never steal a live owner's profile
		// merely because its lock timestamp has aged beyond the stale threshold.
		if (hasLiveOwner(ownerPath)) continue;
		mkdirSync(sessionPath, { recursive: true });
		let unlock: () => void;
		try {
			unlock = lockSync(sessionPath, { lockfilePath, stale: STALE_MS });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ELOCKED") continue;
			throw error;
		}
		try {
			writeFileSync(ownerPath, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
		} catch (error) {
			unlock();
			throw error;
		}
		let released = false;
		return {
			sessionPath,
			release() {
				if (released) return;
				released = true;
				// Remove our marker before unlocking; a new owner must not lose its marker.
				rmSync(ownerPath, { force: true });
				unlock();
			},
		};
	}
	throw new Error("No free Recordly session profile is available.");
}
