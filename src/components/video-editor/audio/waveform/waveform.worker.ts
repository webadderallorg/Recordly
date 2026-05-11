type WaveformWorkerRequest = {
	requestId: number;
	channels: Float32Array[];
	samples: number;
};

interface WorkerContext {
	onmessage: (e: MessageEvent<WaveformWorkerRequest>) => void;
	postMessage: (message: any, transfer?: Transferable[]) => void;
}

const workerScope = self as unknown as WorkerContext;

workerScope.onmessage = (e: MessageEvent<WaveformWorkerRequest>) => {
	const { requestId, channels, samples } = e.data;

	if (!channels || channels.length === 0 || samples <= 0) {
		const empty = new Float32Array(0);
		workerScope.postMessage({ requestId, peaks: empty }, [empty.buffer]);
		return;
	}

	try {
		const firstChannel = channels[0];
		const result = new Float32Array(samples);
		const total = firstChannel.length;
		const blockSize = total / samples;

		for (let i = 0; i < samples; i++) {
			const start = Math.floor(i * blockSize);
			const end = Math.min(total, Math.floor((i + 1) * blockSize));
			
			let max = 0;
			// Ensure we check at least one sample even if blockSize < 1
			const actualEnd = Math.max(start + 1, end);
			
			for (let j = start; j < actualEnd && j < total; j++) {
				for (let c = 0; c < channels.length; c++) {
					const val = Math.abs(channels[c][j]);
					if (val > max) max = val;
				}
			}
			result[i] = max;
		}

		workerScope.postMessage({ requestId, peaks: result }, [result.buffer]);
	} catch (err) {
		workerScope.postMessage({
			requestId,
			error: err instanceof Error ? err.message : "Unknown worker error",
		});
	}
};
