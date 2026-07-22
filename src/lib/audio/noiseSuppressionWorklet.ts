import {
	createNoiseSuppressorWithFallback,
	type NoiseSuppressionMode,
	type NoiseSuppressionSelection,
} from "./noiseSuppression";

declare const AudioWorkletProcessor: {
	new (): AudioWorkletProcessor;
};
declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const currentTime: number;

type AudioWorkletProcessor = {
	readonly port: MessagePort;
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

type NoiseSuppressionWorkletMessage =
	| {
			type: "init";
			mode: NoiseSuppressionMode;
			frameSize: number;
			frameBudgetMs: number;
			longFrameLogIntervalMs: number;
			sampleRate: number;
	  }
	| { type: "destroy" };

class NoiseSuppressionProcessor extends AudioWorkletProcessor {
	private droppedFrames = 0;
	private frameBudgetMs = 12;
	private frameSize = 1024;
	private inputBuffer = new Float32Array(1024);
	private inputBufferOffset = 0;
	private lastLongFrameLogAt = 0;
	private longFrameLogIntervalMs = 5000;
	private outputBuffer: Float32Array<ArrayBufferLike> = new Float32Array(0);
	private sampleRate = 48000;
	private selection: NoiseSuppressionSelection | null = null;
	private scratchFrame = new Float32Array(1024);

	constructor() {
		super();
		this.port.onmessage = (event: MessageEvent<NoiseSuppressionWorkletMessage>) => {
			if (event.data.type === "init") {
				void this.initialize(event.data);
				return;
			}
			this.destroy();
		};
	}

	private async initialize({
		mode,
		frameSize,
		frameBudgetMs,
		longFrameLogIntervalMs,
		sampleRate,
	}: Extract<NoiseSuppressionWorkletMessage, { type: "init" }>) {
		this.frameSize = frameSize;
		this.frameBudgetMs = frameBudgetMs;
		this.longFrameLogIntervalMs = longFrameLogIntervalMs;
		this.sampleRate = sampleRate;
		this.inputBuffer = new Float32Array(frameSize);
		this.inputBufferOffset = 0;
		this.outputBuffer = new Float32Array(0);
		this.scratchFrame = new Float32Array(frameSize);

		try {
			this.selection = await createNoiseSuppressorWithFallback({
				mode,
				frameSize,
				sampleRate,
			});
			this.port.postMessage({
				type: "ready",
				activeMode: this.selection.activeMode,
				requestedMode: this.selection.requestedMode,
				warnings: this.selection.warnings,
			});
		} catch (error) {
			this.port.postMessage({
				type: "error",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][]) {
		const input = inputs[0]?.[0];
		const output = outputs[0]?.[0];
		if (!output) {
			return true;
		}

		if (!input || !this.selection) {
			output.fill(0);
			return true;
		}

		let inputOffset = 0;
		while (inputOffset < input.length) {
			const writableLength = Math.min(
				this.frameSize - this.inputBufferOffset,
				input.length - inputOffset,
			);
			this.inputBuffer.set(
				input.subarray(inputOffset, inputOffset + writableLength),
				this.inputBufferOffset,
			);
			this.inputBufferOffset += writableLength;
			inputOffset += writableLength;

			if (this.inputBufferOffset === this.frameSize) {
				this.processBufferedFrame();
				this.inputBufferOffset = 0;
			}
		}

		const readableLength = Math.min(output.length, this.outputBuffer.length);
		if (readableLength > 0) {
			output.set(this.outputBuffer.subarray(0, readableLength));
			this.outputBuffer = this.outputBuffer.slice(readableLength);
		}
		if (readableLength < output.length) {
			output.fill(0, readableLength);
		}

		return true;
	}

	private processBufferedFrame() {
		if (!this.selection) {
			return;
		}

		const startedAt = getNowMs();
		try {
			this.scratchFrame.set(this.inputBuffer);
			this.outputBuffer = appendFloat32Arrays(
				this.outputBuffer,
				this.selection.suppressor.processAudioFrame(this.scratchFrame),
			);
		} catch (error) {
			this.droppedFrames += 1;
			this.outputBuffer = appendFloat32Arrays(this.outputBuffer, this.inputBuffer);
			this.port.postMessage({
				type: "processing-error",
				activeMode: this.selection.activeMode,
				droppedFrames: this.droppedFrames,
				error: error instanceof Error ? error.message : String(error),
			});
		}

		const now = getNowMs();
		const elapsedMs = now - startedAt;
		if (
			elapsedMs > this.frameBudgetMs &&
			now - this.lastLongFrameLogAt > this.longFrameLogIntervalMs
		) {
			this.lastLongFrameLogAt = now;
			this.port.postMessage({
				type: "long-frame",
				activeMode: this.selection.activeMode,
				elapsedMs: Number(elapsedMs.toFixed(2)),
				frameSize: this.frameSize,
				sampleRate: this.sampleRate,
			});
		}
	}

	private destroy() {
		this.selection?.suppressor.destroy();
		this.selection = null;
		this.outputBuffer = new Float32Array(0);
		this.inputBufferOffset = 0;
	}
}

function appendFloat32Arrays(
	left: Float32Array<ArrayBufferLike>,
	right: Float32Array<ArrayBufferLike>,
) {
	if (left.length === 0) {
		return right.slice();
	}
	if (right.length === 0) {
		return left;
	}

	const combined = new Float32Array(left.length + right.length);
	combined.set(left);
	combined.set(right, left.length);
	return combined;
}

function getNowMs() {
	return globalThis.performance?.now() ?? currentTime * 1000;
}

registerProcessor("noise-suppression-processor", NoiseSuppressionProcessor);
