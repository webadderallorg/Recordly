import { expect, it, vi } from "vitest";
import { prepareIOSPermissions } from "./permissions";

it("does not prompt again after denial and never asks for audio when disabled", async () => {
	const request = vi.fn(async () => true);
	await expect(
		prepareIOSPermissions(
			{ deviceAudio: false, microphoneToken: null },
			{
				status: () => "denied",
				request,
			},
		),
	).rejects.toThrow("PERMISSION_DENIED");
	expect(request).not.toHaveBeenCalled();
	const status = vi.fn(() => "granted");
	await prepareIOSPermissions({ deviceAudio: false, microphoneToken: null }, { status, request });
	expect(status).toHaveBeenCalledExactlyOnceWith("camera");
});
it("requests only undetermined camera and selected audio access", async () => {
	const request = vi.fn(async () => true);
	await prepareIOSPermissions(
		{ deviceAudio: true, microphoneToken: null },
		{ status: () => "not-determined", request },
	);
	expect(request.mock.calls).toEqual([["camera"], ["microphone"]]);
});
