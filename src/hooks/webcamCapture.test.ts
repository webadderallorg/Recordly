import { afterEach, expect, it, vi } from "vitest";
import { acquireWebcamCapture } from "./webcamCapture";

function fakeCamera(deviceId: string) {
	const stop = vi.fn();
	const track = { stop, getSettings: () => ({ deviceId }) };
	const stream = {
		active: true,
		getTracks: () => [track],
		getVideoTracks: () => [track],
	} as unknown as MediaStream;
	return { stream, stop };
}

afterEach(() => vi.unstubAllGlobals());

it.each([
	"matching",
	"different",
	"unavailable",
] as const)("handles the pending default camera (%s) before opening an explicit device", async (defaultResult) => {
	const selectedCamera = fakeCamera("selected");
	const defaultCamera = defaultResult === "matching" ? selectedCamera : fakeCamera("other");
	const openingDefault = Promise.withResolvers<MediaStream>();
	const getUserMedia = vi
		.fn()
		.mockReturnValueOnce(openingDefault.promise)
		.mockResolvedValue(selectedCamera.stream);
	vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
	const initial = acquireWebcamCapture();
	const releaseInitial = initial.then(
		(capture) => capture.release(),
		() => undefined,
	);
	const explicit = acquireWebcamCapture("selected");
	const secondExplicit = acquireWebcamCapture("selected");
	const requestsWhilePending = getUserMedia.mock.calls.length;

	if (defaultResult === "unavailable") {
		openingDefault.reject(new DOMException("Camera disconnected", "NotFoundError"));
	} else {
		openingDefault.resolve(defaultCamera.stream);
	}
	const [first, second] = await Promise.all([explicit, secondExplicit, releaseInitial]);
	try {
		expect(requestsWhilePending).toBe(1);
		expect(first.stream).toBe(selectedCamera.stream);
		expect(second.stream).toBe(first.stream);
		expect(getUserMedia).toHaveBeenCalledTimes(defaultResult === "matching" ? 1 : 2);
		if (defaultResult !== "matching") {
			expect(getUserMedia).toHaveBeenLastCalledWith({
				audio: false,
				video: expect.objectContaining({ deviceId: { exact: "selected" } }),
			});
			expect(defaultCamera.stop).toHaveBeenCalledTimes(defaultResult === "different" ? 1 : 0);
		}
		first.release();
		expect(selectedCamera.stop).not.toHaveBeenCalled();
	} finally {
		first.release();
		second.release();
	}
	expect(selectedCamera.stop).toHaveBeenCalledOnce();
});
