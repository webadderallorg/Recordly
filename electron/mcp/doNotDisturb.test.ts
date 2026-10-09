import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import {
	hasChangedDoNotDisturb,
	MAC_DND_ON_SHORTCUT,
	restoreDoNotDisturb,
	setDoNotDisturb,
} from "./doNotDisturb";

const deps = (platform: NodeJS.Platform, run = vi.fn(async () => "")) => ({ platform, run });

afterEach(async () => {
	await restoreDoNotDisturb(deps("linux"));
});

describe("setDoNotDisturb", () => {
	it("runs the macOS Shortcut and says it could not verify", async () => {
		const d = deps("darwin");
		const result = await setDoNotDisturb(true, d);
		expect(d.run).toHaveBeenCalledWith("shortcuts", ["run", MAC_DND_ON_SHORTCUT]);
		expect(result.ok).toBe(true);
		expect(result.message).toMatch(/cannot confirm|does not let Recordly confirm/i);
	});

	it("returns a clear failure, not a throw, when the Shortcut is missing", async () => {
		const run = vi.fn(async () => {
			throw new Error("Error: Couldn't find shortcut");
		});
		const result = await setDoNotDisturb(true, deps("darwin", run));
		expect(result.ok).toBe(false);
		expect(result.message).toContain("Could not change Do Not Disturb");
		expect(result.message).toContain("Control Centre");
		expect(result.message).toContain(MAC_DND_ON_SHORTCUT);
	});

	it("restores the Linux state it found instead of forcing banners on", async () => {
		const run = vi.fn(async (_c: string, args: string[]) =>
			args[0] === "get" ? "false\n" : "",
		);
		await setDoNotDisturb(true, deps("linux", run));
		expect(run).toHaveBeenCalledWith("gsettings", [
			"set",
			"org.gnome.desktop.notifications",
			"show-banners",
			"false",
		]);
		// banners were already off before (show-banners false), so stay off afterwards
		const result = await setDoNotDisturb(false, deps("linux", run));
		expect(result.enabled).toBe(true);
		expect(run).not.toHaveBeenLastCalledWith("gsettings", expect.arrayContaining(["true"]));
	});

	it("turns banners back on when Recordly was the one that turned them off", async () => {
		const run = vi.fn(async (_c: string, args: string[]) =>
			args[0] === "get" ? "true\n" : "",
		);
		await setDoNotDisturb(true, deps("linux", run));
		const result = await setDoNotDisturb(false, deps("linux", run));
		expect(result).toMatchObject({ ok: true, enabled: false });
		expect(run).toHaveBeenLastCalledWith("gsettings", [
			"set",
			"org.gnome.desktop.notifications",
			"show-banners",
			"true",
		]);
	});

	it("reads and writes the Windows banner switch", async () => {
		const run = vi.fn(async (_c: string, args: string[]) =>
			args[0] === "query"
				? "    NOC_GLOBAL_SETTING_TOASTS_ENABLED    REG_DWORD    0x1\n"
				: "",
		);
		const result = await setDoNotDisturb(true, deps("win32", run));
		expect(result.ok).toBe(true);
		expect(run).toHaveBeenCalledWith("reg", expect.arrayContaining(["add", "/d", "0"]));
	});

	it("reports an unsupported platform without throwing", async () => {
		const result = await setDoNotDisturb(true, deps("freebsd"));
		expect(result.ok).toBe(false);
		expect(result.message).toContain("Could not change Do Not Disturb");
	});
});

describe("Do Not Disturb state", () => {
	const gnome = (initial: string) => {
		let value = initial;
		const run = vi.fn(async (_c: string, args: string[]) => {
			if (args[0] === "get") return `${value}\n`;
			value = args[args.length - 1];
			return "";
		});
		return { run, value: () => value };
	};

	it("keeps the first saved state when switched on twice", async () => {
		const g = gnome("true");
		await setDoNotDisturb(true, deps("linux", g.run));
		await setDoNotDisturb(true, deps("linux", g.run));
		await restoreDoNotDisturb(deps("linux", g.run));
		expect(g.value()).toBe("true");
	});

	it("keeps the first saved state when two switch-ons overlap", async () => {
		let value = "true";
		let reads = 0;
		let writes = 0;
		const run = vi.fn(async (_c: string, args: string[]) => {
			if (args[0] === "get") {
				const slow = ++reads === 2;
				await new Promise((r) => setTimeout(r, slow ? 15 : 0));
				return `${value}\n`;
			}
			value = args[args.length - 1];
			await new Promise((r) => setTimeout(r, ++writes === 1 ? 60 : 0));
			return "";
		});
		await Promise.all([
			setDoNotDisturb(true, deps("linux", run)),
			setDoNotDisturb(true, deps("linux", run)),
		]);
		await restoreDoNotDisturb(deps("linux", run));
		expect(value).toBe("true");
	});

	it("forgets what it saved once restored, and restoring twice writes nothing", async () => {
		const g = gnome("true");
		await setDoNotDisturb(true, deps("linux", g.run));
		expect(hasChangedDoNotDisturb()).toBe(true);
		await restoreDoNotDisturb(deps("linux", g.run));
		expect(hasChangedDoNotDisturb()).toBe(false);
		g.run.mockClear();
		expect(await restoreDoNotDisturb(deps("linux", g.run))).toBeNull();
		expect(g.run).not.toHaveBeenCalled();
	});

	it("keeps the saved state when the restore write fails so it can be retried", async () => {
		const g = gnome("true");
		await setDoNotDisturb(true, deps("linux", g.run));
		const failing = vi.fn(async () => {
			throw new Error("dconf locked");
		});
		const result = await restoreDoNotDisturb(deps("linux", failing));
		expect(result?.ok).toBe(false);
		expect(hasChangedDoNotDisturb()).toBe(true);
	});

	it("does not mark the state changed when the first switch-on fails", async () => {
		const failing = vi.fn(async () => {
			throw new Error("spawn gsettings ENOENT");
		});
		const result = await setDoNotDisturb(true, deps("linux", failing));
		expect(result.ok).toBe(false);
		expect(result.message).toContain("ENOENT");
		expect(hasChangedDoNotDisturb()).toBe(false);
	});

	it("reports a denied Windows registry write as a failure", async () => {
		const run = vi.fn(async (_c: string, args: string[]) => {
			if (args[0] === "add") throw new Error("ERROR: Access is denied.");
			return "";
		});
		const result = await setDoNotDisturb(true, deps("win32", run));
		expect(result.ok).toBe(false);
		expect(result.message).toContain("Access is denied");
	});
});

describe("the real command runner", () => {
	it("kills a hung command for good and says it timed out", async () => {
		execFileMock.mockImplementation((_c, _a, _o, cb) =>
			cb(Object.assign(new Error("Command failed"), { killed: true }), "", ""),
		);
		const result = await setDoNotDisturb(true);
		expect(execFileMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Array),
			expect.objectContaining({ timeout: 8000, killSignal: "SIGKILL" }),
			expect.any(Function),
		);
		expect(result.ok).toBe(false);
		expect(result.message).toContain("did not finish");
		execFileMock.mockReset();
	});
});
