import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveMediaElementSource } from "./localMediaSource";

describe("resolveMediaElementSource", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		Object.assign(globalThis, {
			window: {
				electronAPI: {
					readLocalFile: vi.fn(),
				},
			},
		});
		vi.stubGlobal("URL", {
			createObjectURL: vi.fn(() => "blob:mock-local-media"),
			revokeObjectURL: vi.fn(),
		});
	});

	it("reads file URLs through Electron IPC and returns an object URL", async () => {
		const readLocalFile = vi.fn(async () => ({
			success: true,
			data: new Uint8Array([1, 2, 3]),
		}));
		(window as any).electronAPI.readLocalFile = readLocalFile;

		const result = await resolveMediaElementSource("file:///tmp/example.mp4");

		expect(readLocalFile).toHaveBeenCalledWith("/tmp/example.mp4");
		expect(URL.createObjectURL).toHaveBeenCalledOnce();
		expect(result.src).toBe("blob:mock-local-media");

		result.revoke();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-local-media");
	});

	it("reads absolute local paths through Electron IPC and normalizes fallback URLs", async () => {
		const readLocalFile = vi.fn(async () => ({
			success: true,
			data: new Uint8Array([4, 5, 6]),
		}));
		(window as any).electronAPI.readLocalFile = readLocalFile;

		const result = await resolveMediaElementSource("/tmp/example.wav");

		expect(readLocalFile).toHaveBeenCalledWith("/tmp/example.wav");
		expect(result.src).toBe("blob:mock-local-media");
	});

	it("leaves remote URLs untouched", async () => {
		const readLocalFile = vi.fn();
		(window as any).electronAPI.readLocalFile = readLocalFile;

		const result = await resolveMediaElementSource("https://example.com/video.mp4");

		expect(result.src).toBe("https://example.com/video.mp4");
		expect(readLocalFile).not.toHaveBeenCalled();
	});
});