import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { shareSafeStorageKey } from "./instanceSession";

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

it("seeds a new secondary profile with the primary's secure storage key", () => {
	writeState(primary, { os_crypt: { encrypted_key: "PRIMARY" }, other: 1 });
	expect(shareSafeStorageKey(primary, slot)).toBe(true);
	expect(readState(slot)).toEqual({ os_crypt: { encrypted_key: "PRIMARY" } });
});

it("replaces a secondary's own key while keeping its other settings", () => {
	writeState(primary, { os_crypt: { encrypted_key: "PRIMARY" } });
	writeState(slot, {
		os_crypt: { encrypted_key: "OWN", audit_enabled: true },
		browser: { x: 1 },
	});
	expect(shareSafeStorageKey(primary, slot)).toBe(true);
	expect(readState(slot)).toEqual({
		os_crypt: { encrypted_key: "PRIMARY", audit_enabled: true },
		browser: { x: 1 },
	});
	expect(shareSafeStorageKey(primary, slot)).toBe(false);
});

it("does nothing without a primary key or for the primary profile itself", () => {
	expect(shareSafeStorageKey(primary, slot)).toBe(false);
	writeState(primary, { os_crypt: {} });
	expect(shareSafeStorageKey(primary, slot)).toBe(false);
	writeState(primary, { os_crypt: { encrypted_key: "PRIMARY" } });
	expect(shareSafeStorageKey(primary, primary)).toBe(false);
	expect(readState(primary)).toEqual({ os_crypt: { encrypted_key: "PRIMARY" } });
});
