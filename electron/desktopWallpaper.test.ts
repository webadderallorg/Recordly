import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const decode = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({ nativeImage: { createFromPath: decode } }));
vi.mock("./ipc/ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "/recordly/ffmpeg" }));
import {
	importDesktopWallpaperImage,
	resolveDesktopWallpaperSource,
	resolveMacWallpaperChoice,
} from "./desktopWallpaper";

let directory: string;
beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-desktop-wallpaper-"));
	decode
		.mockReset()
		.mockReturnValue({ isEmpty: () => false, toPNG: () => Buffer.from("png bytes") });
});
afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

describe("desktop wallpaper source", () => {
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

describe("desktop wallpaper import", () => {
	it("extracts a still from an active aerial video instead of attempting to decode video as an image", async () => {
		const source = path.join(directory, "current-aerial.mov");
		await fs.writeFile(source, "video");
		const run = vi.fn(async (_command: string, args: string[]) => {
			await fs.writeFile(args.at(-1)!, "extracted frame");
			return "";
		});
		const result = await importDesktopWallpaperImage(source, directory, "darwin", run);
		expect(run).toHaveBeenCalledWith(
			"/recordly/ffmpeg",
			expect.arrayContaining(["-i", source, "-frames:v", "1"]),
		);
		expect(decode.mock.calls[0][0]).not.toBe(source);
		expect(await fs.readFile(result, "utf8")).toBe("png bytes");
		expect(
			(await fs.readdir(path.dirname(result))).some((file) => file.startsWith(".aerial-")),
		).toBe(false);
	});
	it("stores immutable app-managed PNGs and reuses identical snapshots", async () => {
		const source = path.join(directory, "wallpaper.jpg");
		await fs.writeFile(source, "source");
		const userData = path.join(directory, "userData");
		const first = await importDesktopWallpaperImage(source, userData);
		const second = await importDesktopWallpaperImage(source, userData);
		expect(second).toBe(first);
		expect(path.dirname(first)).toBe(path.join(userData, "desktop-wallpapers"));
		expect(await fs.readFile(first, "utf8")).toBe("png bytes");
		decode.mockReturnValue({ isEmpty: () => false, toPNG: () => Buffer.from("changed png") });
		const changed = await importDesktopWallpaperImage(source, userData);
		expect(changed).not.toBe(first);
		expect(await fs.readFile(first, "utf8")).toBe("png bytes");
	});
	it("handles extensionless Windows image paths", async () => {
		const source = path.join(directory, "TranscodedWallpaper");
		await fs.writeFile(source, "image");
		expect(await importDesktopWallpaperImage(source, directory, "win32")).toMatch(/\.png$/);
	});
	it("converts HEIC with macOS sips when Electron cannot decode it and removes intermediates", async () => {
		const source = path.join(directory, "wallpaper.heic");
		await fs.writeFile(source, "heic");
		decode.mockReturnValueOnce({ isEmpty: () => true });
		const run = vi.fn(async (_command: string, args: string[]) => {
			await fs.writeFile(args.at(-1)!, "converted");
			return "";
		});
		const imported = await importDesktopWallpaperImage(source, directory, "darwin", run);
		expect(run).toHaveBeenCalledWith(
			"/usr/bin/sips",
			expect.arrayContaining([source, "--out"]),
		);
		expect(await fs.readFile(imported, "utf8")).toBe("png bytes");
		expect(
			(await fs.readdir(path.dirname(imported))).some((file) => file.startsWith(".convert-")),
		).toBe(false);
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
		const invalid = path.join(directory, "invalid.jpg");
		await fs.writeFile(invalid, "invalid");
		decode.mockReturnValue({ isEmpty: () => true });
		await expect(importDesktopWallpaperImage(invalid, directory, "win32")).rejects.toThrow(
			"decoded",
		);
	});
});
