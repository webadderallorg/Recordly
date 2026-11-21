import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const decode = vi.hoisted(() => vi.fn());
const toPNG = vi.hoisted(() => vi.fn(() => Buffer.from("png bytes")));
const nativeWallpaper = vi.hoisted(() => vi.fn());
vi.mock("./ipc/windowsWindowGeometry", () => ({ readWindowsWindowGeometry: nativeWallpaper }));
vi.mock("electron", () => ({ nativeImage: { createFromPath: decode } }));
vi.mock("./ipc/ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "/recordly/ffmpeg" }));

import {
	importDesktopWallpaperImage,
	resolveDesktopWallpaperSource,
	resolveMacWallpaperChoice,
} from "./desktopWallpaper";

let directory: string;
beforeEach(async () => {
	nativeWallpaper.mockReset().mockRejectedValue(new Error("older helper"));
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-desktop-wallpaper-"));
	toPNG.mockClear();
	decode.mockReset().mockReturnValue({ isEmpty: () => false, toPNG });
});
afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

describe("desktop wallpaper source", () => {
	it("rejects a native no-wallpaper result without trying the slow fallback", async () => {
		nativeWallpaper.mockResolvedValue("");
		const run = vi.fn();
		await expect(resolveDesktopWallpaperSource("win32", run)).rejects.toThrow(
			"No desktop wallpaper",
		);
		expect(run).not.toHaveBeenCalled();
	});
	it("uses the native Windows lookup without launching PowerShell", async () => {
		const wallpaper = "C:\\Users\\Name\\背景.jpg";
		nativeWallpaper.mockResolvedValue(wallpaper);
		const run = vi.fn();
		expect(await resolveDesktopWallpaperSource("win32", run)).toBe(wallpaper);
		expect(nativeWallpaper).toHaveBeenCalledWith(["--desktop-wallpaper"]);
		expect(run).not.toHaveBeenCalled();
	});
	it("reads macOS wallpaper through AppKit without System Events automation", async () => {
		const run = vi.fn(async () => JSON.stringify({ source: "/Users/test/My wallpaper.heic" }));
		expect(await resolveDesktopWallpaperSource("darwin", run)).toBe(
			"/Users/test/My wallpaper.heic",
		);
		expect(run.mock.calls[0]?.[0]).toBe("/usr/bin/osascript");
		const args = (run.mock.calls[0] as unknown as [string, string[]])[1];
		expect(args.join(" ")).toContain("desktopImageURLForScreen");
		expect(args.join(" ")).not.toContain("tell application");
	});
	it("reads the current Windows image with SPI_GETDESKWALLPAPER and preserves Unicode", async () => {
		const run = vi.fn(async () => "C:\\Users\\Name\\背景.jpg");
		expect(await resolveDesktopWallpaperSource("win32", run)).toBe("C:\\Users\\Name\\背景.jpg");
		const args = (run.mock.calls[0] as unknown as [string, string[]])[1];
		expect(args.join(" ")).toContain("0x0073");
		expect(args.join(" ")).toContain("-NonInteractive");
	});
	it("fails cleanly for no image, malformed output and unsupported systems", async () => {
		for (const value of ["", "relative.jpg", "/image.jpg\nextra", "/image\0.jpg"]) {
			await expect(
				resolveDesktopWallpaperSource("darwin", async () =>
					JSON.stringify({ source: value }),
				),
			).rejects.toThrow("No desktop wallpaper");
		}
		const run = vi.fn();
		await expect(resolveDesktopWallpaperSource("linux", run)).rejects.toThrow("unavailable");
		expect(run).not.toHaveBeenCalled();
	});
});

describe("modern macOS wallpaper providers", () => {
	const assetID = randomUUID().toUpperCase();
	const preference = JSON.stringify({
		provider: "com.apple.wallpaper.choice.aerials",
		assetID,
		source: "/stale/Golden Gate Sunset.heic",
	});
	const assetPath = (kind: string, extension: string) =>
		path.join(
			directory,
			"Library",
			"Application Support",
			"com.apple.wallpaper",
			"aerials",
			kind,
			`${assetID}.${extension}`,
		);
	it("prefers the active aerial's full-resolution video over the stale NSWorkspace image", async () => {
		const video = assetPath("videos", "mov");
		await fs.mkdir(path.dirname(video), { recursive: true });
		await fs.writeFile(video, "current aerial video");
		expect(await resolveMacWallpaperChoice(preference, directory)).toBe(video);
	});
	it("uses the same active asset's thumbnail when its video is not available", async () => {
		const thumbnail = assetPath("thumbnails", "png");
		await fs.mkdir(path.dirname(thumbnail), { recursive: true });
		await fs.writeFile(thumbnail, "current aerial thumbnail");
		expect(await resolveMacWallpaperChoice(preference, directory)).toBe(thumbnail);
	});
	it("does not silently substitute a stale picture for a missing or malformed aerial", async () => {
		await expect(resolveMacWallpaperChoice(preference, directory)).rejects.toThrow(
			"not been downloaded",
		);
		for (const assetID of [null, "../../private", "", "invalid"]) {
			await expect(
				resolveMacWallpaperChoice(
					JSON.stringify({
						provider: "com.apple.wallpaper.choice.aerials",
						assetID,
						source: "/stale/image.jpg",
					}),
					directory,
				),
			).rejects.toThrow("unavailable");
		}
	});
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const writeOutput = (bytes: Buffer) =>
	vi.fn(async (_command: string, args: string[]) => {
		await fs.writeFile(args.at(-1)!, bytes);
		return "";
	});
const leftovers = async (folder: string) =>
	(await fs.readdir(folder)).filter((file) => file.startsWith(".") && file !== ".");

describe("desktop wallpaper import", () => {
	it("extracts an aerial still as JPEG without a PNG re-encode or the short lookup timeout", async () => {
		const source = path.join(directory, "current-aerial.mov");
		await fs.writeFile(source, "video");
		const run = writeOutput(JPEG);
		const result = await importDesktopWallpaperImage(source, directory, "darwin", run);
		const [command, args, timeout] = run.mock.calls[0] as unknown as [string, string[], number];
		expect(command).toBe("/recordly/ffmpeg");
		expect(args).toEqual(expect.arrayContaining(["-i", source, "-frames:v", "1", "-q:v", "2"]));
		expect(args).not.toContain("png");
		expect(timeout).toBeGreaterThan(5000);
		expect(decode.mock.calls.map(([file]) => file)).not.toContain(source);
		expect(toPNG).not.toHaveBeenCalled();
		expect(result).toMatch(/[a-f0-9]{64}\.jpg$/);
		expect(await fs.readFile(result)).toEqual(JPEG);
		expect(await leftovers(path.dirname(result))).toEqual([]);
	});
	it("reuses the snapshot for an unchanged source without decoding again", async () => {
		const source = path.join(directory, "current-aerial.mov");
		await fs.writeFile(source, "video");
		const run = writeOutput(JPEG);
		const first = await importDesktopWallpaperImage(source, directory, "darwin", run);
		const { mtimeMs } = await fs.stat(first);
		decode.mockClear();
		expect(await importDesktopWallpaperImage(source, directory, "darwin", run)).toBe(first);
		expect(run).toHaveBeenCalledTimes(1);
		expect(decode).not.toHaveBeenCalled();
		expect((await fs.stat(first)).mtimeMs).toBe(mtimeMs);
	});
	it("re-imports when the source changes and keeps earlier snapshots immutable", async () => {
		const source = path.join(directory, "wallpaper.jpg");
		await fs.writeFile(source, JPEG);
		const userData = path.join(directory, "userData");
		const first = await importDesktopWallpaperImage(source, userData, "win32");
		expect(path.dirname(first)).toBe(path.join(userData, "desktop-wallpapers"));
		const changed = Buffer.concat([JPEG, Buffer.from("changed")]);
		await fs.writeFile(source, changed);
		await fs.utimes(source, new Date(), new Date(Date.now() + 60_000));
		const second = await importDesktopWallpaperImage(source, userData, "win32");
		expect(second).not.toBe(first);
		expect(await fs.readFile(first)).toEqual(JPEG);
		expect(await fs.readFile(second)).toEqual(changed);
	});
	it("recovers from a corrupt cache index or a deleted cached snapshot", async () => {
		const source = path.join(directory, "wallpaper.png");
		await fs.writeFile(source, PNG);
		const first = await importDesktopWallpaperImage(source, directory, "win32");
		await fs.rm(first);
		expect(await importDesktopWallpaperImage(source, directory, "win32")).toBe(first);
		expect(await fs.readFile(first)).toEqual(PNG);
		await fs.writeFile(path.join(path.dirname(first), "index.json"), "{not json");
		expect(await importDesktopWallpaperImage(source, directory, "win32")).toBe(first);
	});
	it("keeps decodable JPEG and PNG bytes unchanged, including extensionless Windows paths", async () => {
		for (const [bytes, extension] of [
			[JPEG, "jpg"],
			[PNG, "png"],
		] as const) {
			const source = path.join(directory, `TranscodedWallpaper-${extension}`);
			await fs.writeFile(source, bytes);
			const imported = await importDesktopWallpaperImage(source, directory, "win32");
			expect(imported.endsWith(`.${extension}`)).toBe(true);
			expect(await fs.readFile(imported)).toEqual(bytes);
		}
		expect(toPNG).not.toHaveBeenCalled();
	});
	it("re-encodes other decodable formats as PNG", async () => {
		const source = path.join(directory, "wallpaper.bmp");
		await fs.writeFile(source, "BM bitmap");
		const imported = await importDesktopWallpaperImage(source, directory, "win32");
		expect(imported).toMatch(/\.png$/);
		expect(await fs.readFile(imported, "utf8")).toBe("png bytes");
	});
	it("converts HEIC to JPEG with macOS sips and removes intermediates", async () => {
		const source = path.join(directory, "wallpaper.heic");
		await fs.writeFile(source, "heic");
		const run = writeOutput(JPEG);
		const imported = await importDesktopWallpaperImage(source, directory, "darwin", run);
		expect(run).toHaveBeenCalledWith(
			"/usr/bin/sips",
			expect.arrayContaining(["format", "jpeg", source, "--out"]),
			expect.any(Number),
		);
		expect(toPNG).not.toHaveBeenCalled();
		expect(imported).toMatch(/\.jpg$/);
		expect(await fs.readFile(imported)).toEqual(JPEG);
		expect(await leftovers(path.dirname(imported))).toEqual([]);
	});
	it("falls back to Electron's decoder when sips cannot convert", async () => {
		const source = path.join(directory, "wallpaper.heic");
		await fs.writeFile(source, "heic");
		const run = vi.fn(async () => {
			throw new Error("sips failed");
		});
		const imported = await importDesktopWallpaperImage(source, directory, "darwin", run);
		expect(await fs.readFile(imported, "utf8")).toBe("png bytes");
	});
	it("rejects missing, empty, directory and undecodable sources", async () => {
		await expect(
			importDesktopWallpaperImage(path.join(directory, "missing"), directory),
		).rejects.toThrow();
		const empty = path.join(directory, "empty.jpg");
		await fs.writeFile(empty, "");
		await expect(importDesktopWallpaperImage(empty, directory)).rejects.toThrow(
			"supported image",
		);
		await expect(importDesktopWallpaperImage(directory, directory)).rejects.toThrow(
			"supported image",
		);
		decode.mockReturnValue({ isEmpty: () => true });
		for (const contents of [Buffer.from("invalid"), JPEG]) {
			const invalid = path.join(directory, "invalid.jpg");
			await fs.writeFile(invalid, contents);
			await expect(importDesktopWallpaperImage(invalid, directory, "win32")).rejects.toThrow(
				"decoded",
			);
		}
		const aerial = path.join(directory, "broken.mov");
		await fs.writeFile(aerial, "video");
		await expect(
			importDesktopWallpaperImage(aerial, directory, "darwin", writeOutput(JPEG)),
		).rejects.toThrow("decoded");
	});
});
