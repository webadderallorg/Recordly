import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reserveInstanceSession } from "./instanceSession";

const roots: string[] = [];
const releases: Array<() => void> = [];
function setup() {
	const root = mkdtempSync(path.join(os.tmpdir(), "recordly-session-test-"));
	roots.push(root);
	const userData = path.join(root, "userData");
	const primary = path.join(userData, "session");
	mkdirSync(primary, { recursive: true });
	return { userData, primary };
}
function reserve(userData: string, primary: string) {
	const reservation = reserveInstanceSession(userData, primary);
	releases.push(reservation.release);
	return reservation;
}
afterEach(() => {
	for (const release of releases.splice(0).reverse()) release();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("persistent instance sessions", () => {
	it("preserves existing primary storage across launches", () => {
		const { userData, primary } = setup();
		const saved = path.join(primary, "saved-browser-data");
		writeFileSync(saved, "existing folders and preferences");
		const first = reserve(userData, primary);
		expect(first.sessionPath).toBe(primary);
		expect(readFileSync(saved, "utf8")).toBe("existing folders and preferences");
		first.release();
		const next = reserve(userData, primary);
		expect(next.sessionPath).toBe(primary);
		expect(readFileSync(saved, "utf8")).toBe("existing folders and preferences");
	});

	it("keeps concurrent profiles separate and reuses durable secondary storage", () => {
		const { userData, primary } = setup();
		const first = reserve(userData, primary);
		const second = reserve(userData, primary);
		expect(second.sessionPath).toBe(path.join(userData, "instance-sessions", "slot-1"));
		const saved = path.join(second.sessionPath, "secondary-preferences");
		writeFileSync(saved, "saved");
		expect(first.sessionPath).toBe(primary);
		second.release();
		const replacement = reserve(userData, primary);
		expect(replacement.sessionPath).toBe(second.sessionPath);
		expect(readFileSync(saved, "utf8")).toBe("saved");
	});

	it("does not steal a live profile after its heartbeat ages during sleep", () => {
		const { userData, primary } = setup();
		reserve(userData, primary);
		const lockPath = path.join(userData, "instance-sessions", ".locks", "primary.lock");
		const old = new Date(Date.now() - 60_000);
		utimesSync(lockPath, old, old);
		expect(reserve(userData, primary).sessionPath).not.toBe(primary);
	});

	it("recovers a stale crashed primary without deleting saved profile data", () => {
		const { userData, primary } = setup();
		const locks = path.join(userData, "instance-sessions", ".locks");
		const lockPath = path.join(locks, "primary.lock");
		mkdirSync(lockPath, { recursive: true });
		const child = spawnSync(
			process.execPath,
			["-e", "process.stdout.write(String(process.pid))"],
			{
				encoding: "utf8",
			},
		);
		expect(child.status).toBe(0);
		writeFileSync(
			path.join(locks, "primary.owner.json"),
			JSON.stringify({ pid: Number(child.stdout) }),
		);
		const old = new Date(Date.now() - 60_000);
		utimesSync(lockPath, old, old);
		const saved = path.join(primary, "saved-data");
		writeFileSync(saved, "preserved");
		expect(reserve(userData, primary).sessionPath).toBe(primary);
		expect(readFileSync(saved, "utf8")).toBe("preserved");
	});

	it("uses another profile while a crashed lease is still fresh", () => {
		const { userData, primary } = setup();
		mkdirSync(path.join(userData, "instance-sessions", ".locks", "primary.lock"), {
			recursive: true,
		});
		expect(reserve(userData, primary).sessionPath).not.toBe(primary);
	});
});
