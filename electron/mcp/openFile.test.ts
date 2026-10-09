import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { openPath: vi.fn() } }));

const { createOpenFile, splitGlob } = await import("./openFile");

let dir: string;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-open-file-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe("openFile", () => {
	it("opens the file and hands back the selected source id", async () => {
		const file = path.join(dir, "book.xlsx");
		await fs.writeFile(file, "x");
		const openPath = vi.fn(async () => "");
		const selectFrontWindow = vi.fn(async () => ({ id: "window:42:0" }));
		const tools = createOpenFile({ openPath, selectFrontWindow });
		const result = await tools.openFile({ path: file, thenSelectSource: true });
		expect(openPath).toHaveBeenCalledWith(file);
		expect(result.sourceId).toBe("window:42:0");
	});

	it("uses the named app and passes it on to the window picker", async () => {
		const file = path.join(dir, "book.xlsx");
		await fs.writeFile(file, "x");
		const openWithApp = vi.fn(async () => undefined);
		const selectFrontWindow = vi.fn(async () => ({ id: "window:1:0" }));
		await createOpenFile({ openWithApp, selectFrontWindow }).openFile({
			path: file,
			withApp: "Numbers",
			thenSelectSource: true,
		});
		expect(openWithApp).toHaveBeenCalledWith(file, "Numbers");
		expect(selectFrontWindow).toHaveBeenCalledWith("Numbers");
	});

	it("explains a missing file and a failed open", async () => {
		const tools = createOpenFile({ openPath: async () => "no app" });
		await expect(tools.openFile({ path: path.join(dir, "no.txt") })).rejects.toThrow(/no file/);
		const file = path.join(dir, "a.txt");
		await fs.writeFile(file, "x");
		await expect(tools.openFile({ path: file })).rejects.toThrow(/no app/);
	});

	it("refuses a folder instead of opening it in the file manager", async () => {
		const openPath = vi.fn(async () => "");
		const folder = path.join(dir, "sheets");
		await fs.mkdir(folder);
		await expect(createOpenFile({ openPath }).openFile({ path: folder })).rejects.toThrow(
			/folder, not a file/,
		);
		expect(openPath).not.toHaveBeenCalled();
	});
});

describe("splitGlob", () => {
	it("matches * and ? in the file name only", () => {
		const { matches } = splitGlob("/d/report-?.xlsx");
		expect(matches("report-1.xlsx")).toBe(true);
		expect(matches("report-12.xlsx")).toBe(false);
		expect(splitGlob("/d/*.xlsx").matches("a.b.xlsx")).toBe(true);
		expect(() => splitGlob("/d/*/x.xlsx")).toThrow(/file name/);
		expect(() => splitGlob("*.xlsx")).toThrow(/absolute/);
	});
});

describe("waitForDownload", () => {
	function clock() {
		let t = 0;
		return {
			now: () => t,
			sleep: async (ms: number) => {
				t += ms;
			},
			pollMs: 500,
		};
	}

	it("ignores a half-written file until its size stops changing", async () => {
		const file = path.join(dir, "data.xlsx");
		let polls = 0;
		const c = clock();
		const tools = createOpenFile({
			...c,
			sleep: async (ms) => {
				await c.sleep(ms);
				polls++;
				if (polls < 3) await fs.writeFile(file, "x".repeat(polls * 10)); // still growing
			},
		});
		const result = await tools.waitForDownload({ glob: path.join(dir, "*.xlsx") });
		expect(result.path).toBe(file);
		expect(polls).toBeGreaterThanOrEqual(3);
		expect(result.sizeBytes).toBe(20);
	});

	it("skips the browser's partial-download file and files that were already there", async () => {
		await fs.writeFile(path.join(dir, "old.xlsx"), "old");
		await fs.writeFile(path.join(dir, "new.xlsx.crdownload"), "partial");
		const c = clock();
		let once = false;
		const tools = createOpenFile({
			...c,
			sleep: async (ms) => {
				await c.sleep(ms);
				if (!once) {
					once = true;
					await fs.rename(
						path.join(dir, "new.xlsx.crdownload"),
						path.join(dir, "new.xlsx"),
					);
				}
			},
		});
		const result = await tools.waitForDownload({ glob: path.join(dir, "*.xlsx") });
		expect(path.basename(result.path)).toBe("new.xlsx");
	});

	it("finds a download that finished before the call when sinceMs is given", async () => {
		const stale = path.join(dir, "old.xlsx");
		const fresh = path.join(dir, "report.xlsx");
		await fs.writeFile(stale, "old");
		await fs.utimes(stale, new Date(1_000), new Date(1_000));
		await fs.writeFile(fresh, "already finished");
		const clicked = (await fs.stat(fresh)).mtimeMs;

		const tools = createOpenFile(clock());
		await expect(
			tools.waitForDownload({ glob: path.join(dir, "*.xlsx"), timeoutMs: 2_000 }),
		).rejects.toThrow(/No finished download/);

		const found = await tools.waitForDownload({
			glob: path.join(dir, "*.xlsx"),
			sinceMs: clicked,
		});
		expect(path.basename(found.path)).toBe("report.xlsx");

		await expect(
			tools.waitForDownload({
				glob: path.join(dir, "*.xlsx"),
				sinceMs: Number.NaN,
			}),
		).rejects.toThrow(/sinceMs must be a number/);
	});

	it("times out with a plain message and caps the timeout", async () => {
		const c = clock();
		const tools = createOpenFile(c);
		await expect(
			tools.waitForDownload({ glob: path.join(dir, "*.xlsx"), timeoutMs: 2_000 }),
		).rejects.toThrow(/within 2 s/);
		await expect(
			tools.waitForDownload({ glob: path.join(dir, "*.xlsx"), timeoutMs: 99 * 60_000 }),
		).rejects.toThrow(/within 300 s/);
	});
});
