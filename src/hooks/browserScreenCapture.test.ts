import { describe, expect, it, vi } from "vitest";
import { acquireBrowserScreenCapture } from "./browserScreenCapture";

describe("browser screen capture fallback", () => {
	for (const name of ["NotAllowedError", "AbortError"]) {
		it(`does not reopen a dismissed Wayland portal (${name})`, async () => {
			const error = new DOMException("Cancelled", name);
			const request = vi.fn().mockRejectedValue(error);
			const onAudioFallback = vi.fn();
			await expect(
				acquireBrowserScreenCapture({
					request,
					audio: true,
					usePortal: true,
					onAudioFallback,
				}),
			).rejects.toBe(error);
			expect(request).toHaveBeenCalledExactlyOnceWith(true);
			expect(onAudioFallback).not.toHaveBeenCalled();
		});
	}
	it("retries without audio when audio capture is unsupported", async () => {
		const stream = {} as MediaStream;
		const request = vi
			.fn()
			.mockRejectedValueOnce(new DOMException("Audio unavailable", "NotSupportedError"))
			.mockResolvedValueOnce(stream);
		const onAudioFallback = vi.fn();
		expect(
			await acquireBrowserScreenCapture({
				request,
				audio: true,
				usePortal: true,
				onAudioFallback,
			}),
		).toBe(stream);
		expect(request.mock.calls).toEqual([[true], [false]]);
		expect(onAudioFallback).toHaveBeenCalledOnce();
	});
	it("does not retry video-only capture failures", async () => {
		const error = new Error("Closed window");
		const request = vi.fn().mockRejectedValue(error);
		const onAudioFallback = vi.fn();
		await expect(
			acquireBrowserScreenCapture({
				request,
				audio: false,
				usePortal: false,
				onAudioFallback,
			}),
		).rejects.toBe(error);
		expect(request).toHaveBeenCalledOnce();
		expect(onAudioFallback).not.toHaveBeenCalled();
	});
	it("preserves X11 audio fallback", async () => {
		const stream = {} as MediaStream;
		const request = vi
			.fn()
			.mockRejectedValueOnce(new DOMException("Audio unavailable", "NotAllowedError"))
			.mockResolvedValueOnce(stream);
		expect(
			await acquireBrowserScreenCapture({
				request,
				audio: true,
				usePortal: false,
				onAudioFallback: vi.fn(),
			}),
		).toBe(stream);
		expect(request.mock.calls).toEqual([[true], [false]]);
	});
});
