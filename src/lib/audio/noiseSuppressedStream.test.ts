import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNoiseSuppressedMicrophoneStream } from "./noiseSuppressedStream";

vi.mock("./noiseSuppressionWorklet.ts?worker&url", () => ({
	default: "mock-noise-suppression-worklet-url",
}));

type FakeMediaStreamTrack = MediaStreamTrack & {
	stop: ReturnType<typeof vi.fn>;
};

type FakeMediaStream = MediaStream & {
	getTracks: ReturnType<typeof vi.fn<() => FakeMediaStreamTrack[]>>;
};

type FakeAudioNode = {
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
};

const createdContexts: FakeAudioContext[] = [];
const createdProcessors: FakeAudioWorkletNode[] = [];
let addModule = vi.fn();

class FakeAudioContext {
	readonly audioWorklet = {
		addModule: (...args: unknown[]) => addModule(...args),
	};
	readonly close = vi.fn().mockResolvedValue(undefined);
	readonly sampleRate = 48000;
	readonly sourceNode = createFakeAudioNode();
	readonly destinationNode = {
		...createFakeAudioNode(),
		stream: createFakeMediaStream().stream,
	};

	constructor() {
		createdContexts.push(this);
	}

	createMediaStreamSource() {
		return this.sourceNode;
	}

	createMediaStreamDestination() {
		return this.destinationNode;
	}
}

class FakeAudioWorkletNode {
	readonly connect = vi.fn();
	readonly disconnect = vi.fn();
	readonly port = {
		onmessage: null as ((event: MessageEvent) => void) | null,
		postMessage: vi.fn(),
	};

	constructor() {
		createdProcessors.push(this);
	}
}

function createFakeAudioNode(): FakeAudioNode {
	return {
		connect: vi.fn(),
		disconnect: vi.fn(),
	};
}

function createFakeMediaStream(trackCount = 1) {
	const tracks = Array.from({ length: trackCount }, () => ({
		stop: vi.fn(),
	})) as FakeMediaStreamTrack[];
	const stream = {
		getTracks: vi.fn(() => tracks),
	} as FakeMediaStream;

	return { stream, tracks };
}

beforeEach(() => {
	addModule = vi.fn().mockResolvedValue(undefined);
	createdContexts.length = 0;
	createdProcessors.length = 0;
	vi.stubGlobal("AudioContext", FakeAudioContext);
	vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("createNoiseSuppressedMicrophoneStream", () => {
	it("stops source tracks and closes the AudioContext when loading the worklet fails", async () => {
		const { stream, tracks } = createFakeMediaStream(2);
		addModule.mockRejectedValue(new Error("worklet blocked"));

		await expect(
			createNoiseSuppressedMicrophoneStream({
				sourceStream: stream,
				mode: "rnnoise",
			}),
		).rejects.toThrow("worklet blocked");

		expect(tracks[0].stop).toHaveBeenCalledTimes(1);
		expect(tracks[1].stop).toHaveBeenCalledTimes(1);
		expect(createdContexts[0].sourceNode.disconnect).toHaveBeenCalledTimes(1);
		expect(createdContexts[0].close).toHaveBeenCalledTimes(1);
	});

	it("times out a nonresponsive worklet and runs setup cleanup", async () => {
		vi.useFakeTimers();
		const { stream, tracks } = createFakeMediaStream();

		const setup = createNoiseSuppressedMicrophoneStream({
			sourceStream: stream,
			mode: "rnnoise",
		});
		const rejection = expect(setup).rejects.toThrow(
			"Noise suppression worklet initialization timed out.",
		);
		await vi.advanceTimersByTimeAsync(5000);

		await rejection;
		expect(createdProcessors[0].port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "init" }),
		);
		expect(createdProcessors[0].port.postMessage).toHaveBeenCalledWith({ type: "destroy" });
		expect(tracks[0].stop).toHaveBeenCalledTimes(1);
		expect(createdContexts[0].sourceNode.disconnect).toHaveBeenCalledTimes(1);
		expect(createdContexts[0].close).toHaveBeenCalledTimes(1);
	});
});
