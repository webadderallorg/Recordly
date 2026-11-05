import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.platform !== "darwin")("native cursor helpers", () => {
	let directory: string;
	let monitor: string;
	let assets: string;
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-cursor-helpers-"));
		monitor = join(directory, "monitor");
		assets = join(directory, "assets");
		for (const [source, output] of [
			["NativeCursorMonitor.swift", monitor],
			["SystemCursorAssets.swift", assets],
		]) {
			execFileSync(
				"swiftc",
				["-O", fileURLToPath(new URL(source, import.meta.url)), "-o", output],
				{
					timeout: 60_000,
				},
			);
		}
	}, 120_000);
	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	it("reports cursor state as a background process and exits when stopped", async () => {
		const child = spawn(monitor, [], { stdio: ["pipe", "pipe", "pipe"] });
		let output = "";
		const exited = new Promise<number | null>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", resolve);
		});
		try {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error("Cursor state did not arrive")),
					5000,
				);
				child.stdout.on("data", (data) => {
					output += data.toString();
					if (/^STATE:\S+/m.test(output)) {
						clearTimeout(timeout);
						resolve();
					}
				});
				child.once("exit", () => {
					clearTimeout(timeout);
					// Reject only an early exit; a resolved promise ignores this.
					reject(new Error("Cursor monitor exited before reporting state"));
				});
			});
			const applications = execFileSync("lsappinfo", ["list"], { encoding: "utf8" });
			const registration = applications
				.split(/(?=^\d+\))/m)
				.find((entry) => entry.includes(`pid = ${child.pid} `));
			expect(registration).toContain('type="BackgroundOnly"');
			child.stdin.end("stop\n");
			expect(await exited).toBe(0);
		} finally {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await exited;
		}
	}, 10_000);

	it("still exports usable system cursor artwork without a foreground app", () => {
		const result = JSON.parse(execFileSync(assets, [], { encoding: "utf8", timeout: 10_000 }));
		expect(Object.keys(result)).toHaveLength(9);
		for (const asset of Object.values(result) as {
			dataUrl: string;
			width: number;
			height: number;
		}[]) {
			expect(asset.dataUrl).toMatch(/^data:image\/png;base64,/);
			expect(asset.width).toBeGreaterThan(0);
			expect(asset.height).toBeGreaterThan(0);
		}
	});
});
