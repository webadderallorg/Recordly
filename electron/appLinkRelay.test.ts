import fs from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createAppLinkRelay,
	findActivationLink,
	isActivationLink,
	shouldForwardPlainLaunch,
} from "./appLinkRelay";

let directory: string;
const relays: Array<{ close: () => Promise<void> }> = [];

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-app-links-"));
});

afterEach(async () => {
	await Promise.all(relays.splice(0).map((relay) => relay.close()));
	await fs.rm(directory, { recursive: true, force: true });
});

function relay(
	pid: number,
	extra: { now?: () => number; isAlive?: (pid: number) => boolean } = {},
) {
	const instance = createAppLinkRelay({
		directory,
		protocol: "recordly",
		pid,
		isAlive: extra.isAlive ?? (() => true),
		now: extra.now,
	});
	relays.push(instance);
	return instance;
}

it("recognises only the data-free activation routes", () => {
	expect(isActivationLink("recordly://app/open", "recordly")).toBe(true);
	expect(isActivationLink("recordly://billing/return", "recordly")).toBe(true);
	expect(isActivationLink("recordly-dev://app/open", "recordly")).toBe(false);
	expect(isActivationLink("recordly://auth/callback?code=x", "recordly")).toBe(false);
	expect(isActivationLink("recordly://user:pw@app/open", "recordly")).toBe(false);
	expect(isActivationLink("https://app/open", "recordly")).toBe(false);
	expect(findActivationLink(["electron", ".", "recordly-dev://app/open"], "recordly-dev")).toBe(
		"recordly-dev://app/open",
	);
	expect(findActivationLink(["electron", "."], "recordly")).toBeNull();
});

it("brings the most recently focused running instance forward", async () => {
	let clock = 1;
	const older = vi.fn();
	const newer = vi.fn();
	const first = relay(101, { now: () => clock++ });
	const second = relay(102, { now: () => clock++ });
	await first.listen(older);
	await second.listen(newer);
	await first.markFocused();

	const launcher = relay(103);
	await expect(launcher.forward()).resolves.toBe(true);
	expect(older).toHaveBeenCalledOnce();
	expect(newer).not.toHaveBeenCalled();
});

it("reports no instance when none is running and cleans dead records", async () => {
	const alive = new Set([201]);
	const running = relay(201, { isAlive: (pid) => alive.has(pid) });
	await running.listen(vi.fn());
	alive.delete(201);

	const launcher = relay(202, { isAlive: (pid) => alive.has(pid) });
	await expect(launcher.forward()).resolves.toBe(false);
	expect(await fs.readdir(directory)).toEqual([]);
});

it("ignores its own record and falls through unreachable instances", async () => {
	const self = relay(301);
	await self.listen(vi.fn());
	await expect(self.forward()).resolves.toBe(false);
	await self.close();

	await fs.writeFile(
		path.join(directory, "recordly.302.json"),
		JSON.stringify({
			version: 1,
			protocol: "recordly",
			pid: 302,
			port: 1,
			token: "0".repeat(32),
			focusedAt: Number.MAX_SAFE_INTEGER,
		}),
	);
	const onActivate = vi.fn();
	const reachable = relay(303);
	await reachable.listen(onActivate);
	await expect(relay(304).forward()).resolves.toBe(true);
	expect(onActivate).toHaveBeenCalledOnce();
});

function post(port: number, headers: Record<string, string>): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request(
			{ hostname: "127.0.0.1", port, method: "POST", path: "/v1/activate", headers },
			(res) => {
				res.resume();
				resolve(res.statusCode ?? 0);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

it("rejects requests without the token or from a browser page", async () => {
	const onActivate = vi.fn();
	const running = relay(401);
	await running.listen(onActivate);
	const record = JSON.parse(await fs.readFile(path.join(directory, "recordly.401.json"), "utf8"));

	expect(await post(record.port, {})).toBe(404);
	expect(await post(record.port, { "X-Recordly-Token": "f".repeat(32) })).toBe(404);
	expect(
		await post(record.port, { "X-Recordly-Token": record.token, Origin: "https://evil.test" }),
	).toBe(404);
	expect(onActivate).not.toHaveBeenCalled();
	expect(await post(record.port, { "X-Recordly-Token": record.token })).toBe(204);
	expect(onActivate).toHaveBeenCalledOnce();
});

it("removes its record on close", async () => {
	const running = relay(501);
	await running.listen(vi.fn());
	expect(await fs.readdir(directory)).toEqual(["recordly.501.json"]);
	await running.close();
	expect(await fs.readdir(directory)).toEqual([]);
});

it("forwards repeated shortcut launches to the running app only on packaged Windows and Linux", () => {
	for (const platform of ["win32", "linux"] as const) {
		expect(shouldForwardPlainLaunch({ platform, isPackaged: true, smokeExport: false })).toBe(
			true,
		);
		expect(shouldForwardPlainLaunch({ platform, isPackaged: false, smokeExport: false })).toBe(
			false,
		);
		expect(shouldForwardPlainLaunch({ platform, isPackaged: true, smokeExport: true })).toBe(
			false,
		);
	}
	// macOS already reuses the running app at the OS level.
	expect(
		shouldForwardPlainLaunch({ platform: "darwin", isPackaged: true, smokeExport: false }),
	).toBe(false);
});
