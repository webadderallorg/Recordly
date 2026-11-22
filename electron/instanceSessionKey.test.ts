import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	REPLACED_KEYS_FILE,
	shareSafeStorageKey,
	shareSafeStorageKeyWhenReady,
} from "./instanceSession";

let root: string;
let primary: string;
let slot: string;

beforeEach(() => {
	root = mkdtempSync(path.join(os.tmpdir(), "recordly-key-"));
	primary = path.join(root, "primary");
	slot = path.join(root, "slot-1");
	mkdirSync(primary);
	mkdirSync(slot);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const writeState = (dir: string, state: unknown) =>
	writeFileSync(path.join(dir, "Local State"), JSON.stringify(state));
const readState = (dir: string) => JSON.parse(readFileSync(path.join(dir, "Local State"), "utf8"));
const readReplaced = () => JSON.parse(readFileSync(path.join(slot, REPLACED_KEYS_FILE), "utf8"));

it("seeds a new secondary profile with the primary's secure storage key", () => {
	writeState(primary, { os_crypt: { encrypted_key: "PRIMARY" }, other: 1 });
	expect(shareSafeStorageKey(primary, slot)).toBe("shared");
	expect(readState(slot)).toEqual({ os_crypt: { encrypted_key: "PRIMARY" } });
	expect(existsSync(path.join(slot, REPLACED_KEYS_FILE))).toBe(false);
});

it("replaces a secondary's own key, keeps its other settings, and retains the old key", () => {
	writeState(primary, { os_crypt: { encrypted_key: "PRIMARY" } });
	writeState(slot, {
		os_crypt: { encrypted_key: "OWN", audit_enabled: true },
		browser: { x: 1 },
	});
	expect(shareSafeStorageKey(primary, slot)).toBe("shared");
	expect(readState(slot)).toEqual({
		os_crypt: { encrypted_key: "PRIMARY", audit_enabled: true },
		browser: { x: 1 },
	});
	expect(readReplaced()).toEqual(["OWN"]);
	expect(shareSafeStorageKey(primary, slot)).toBe("unchanged");

	writeState(slot, { os_crypt: { encrypted_key: "NEWER" } });
	expect(shareSafeStorageKey(primary, slot)).toBe("shared");
	expect(readReplaced()).toEqual(["OWN", "NEWER"]);
});

it("leaves both files untouched when the key backup cannot be trusted", () => {
	writeState(primary, { os_crypt: { encrypted_key: "PRIMARY" } });
	writeState(slot, { os_crypt: { encrypted_key: "OWN" } });
	writeFileSync(path.join(slot, REPLACED_KEYS_FILE), "{not json");
	expect(() => shareSafeStorageKey(primary, slot)).toThrow();
	writeFileSync(path.join(slot, REPLACED_KEYS_FILE), JSON.stringify({ keys: ["OLD"] }));
	expect(() => shareSafeStorageKey(primary, slot)).toThrow("Unexpected contents");
	expect(readState(slot)).toEqual({ os_crypt: { encrypted_key: "OWN" } });
	expect(readFileSync(path.join(slot, REPLACED_KEYS_FILE), "utf8")).toBe('{"keys":["OLD"]}');
});

it("does nothing without a primary key or for the primary profile itself", () => {
	expect(shareSafeStorageKey(primary, slot)).toBe("no-primary-key");
	writeState(primary, { os_crypt: {} });
	expect(shareSafeStorageKey(primary, slot)).toBe("no-primary-key");
	writeState(primary, { os_crypt: { encrypted_key: "PRIMARY" } });
	expect(shareSafeStorageKey(primary, primary)).toBe("primary");
	expect(readState(primary)).toEqual({ os_crypt: { encrypted_key: "PRIMARY" } });
});

it("waits for a new primary profile to write its key", () => {
	let sleeps = 0;
	const result = shareSafeStorageKeyWhenReady(primary, slot, {
		timeoutMs: 1000,
		intervalMs: 100,
		sleep: () => {
			sleeps++;
			if (sleeps === 3) writeState(primary, { os_crypt: { encrypted_key: "PRIMARY" } });
		},
	});
	expect(result).toBe("shared");
	expect(sleeps).toBe(3);
	expect(readState(slot).os_crypt.encrypted_key).toBe("PRIMARY");
});

it("gives up after the timeout when the primary never writes a key", () => {
	let sleeps = 0;
	const result = shareSafeStorageKeyWhenReady(primary, slot, {
		timeoutMs: 500,
		intervalMs: 100,
		sleep: () => sleeps++,
	});
	expect(result).toBe("no-primary-key");
	expect(sleeps).toBe(5);
});
