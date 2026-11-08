/** gif.js's frame workers are independent; feed them incrementally instead of
 * retaining every raw RGBA frame in gif.js until render() is called. */
const RAW_FRAME_BUDGET = 128 * 1024 * 1024;
const FRAME_TIMEOUT_MS = 60_000;

export function gifWorkerCount(width: number, height: number, cores: number): number {
	return Math.max(
		1,
		Math.min(
			8,
			Math.floor(cores || 4) - 1,
			Math.floor(RAW_FRAME_BUDGET / (width * height * 4 * 2)),
		),
	);
}

type Slot = { worker: Worker; index: number | null; timer?: ReturnType<typeof setTimeout> };
type Waiter = { resolve: (slot: Slot) => void; reject: (error: Error) => void };
type EncodedFrame = {
	index: number;
	data: Uint8Array<ArrayBuffer>[];
	cursor: number;
	pageSize: number;
};

export class StreamingGifEncoder {
	private slots: Slot[] = [];
	private available: Slot[] = [];
	private waiters: Waiter[] = [];
	private parts: Blob[] = [];
	private submitted = 0;
	private completed = 0;
	private failure: Error | null = null;
	private finishing = false;
	private disposed = false;
	private drain?: { resolve: () => void; reject: (error: Error) => void };
	private canvas: HTMLCanvasElement;
	private context: CanvasRenderingContext2D;

	constructor(
		private options: {
			width: number;
			height: number;
			repeat: number;
			workerScript: string;
			onFrameEncoded?: (completed: number) => void;
		},
	) {
		const { width, height } = options;
		if (
			!Number.isSafeInteger(width) ||
			!Number.isSafeInteger(height) ||
			width < 1 ||
			height < 1 ||
			width > 8192 ||
			height > 8192
		)
			throw new Error("Unsupported GIF dimensions");
		this.canvas = document.createElement("canvas");
		this.canvas.width = width;
		this.canvas.height = height;
		const context = this.canvas.getContext("2d", { willReadFrequently: true });
		if (!context) throw new Error("Could not read GIF frames");
		this.context = context;
		try {
			const count = gifWorkerCount(width, height, navigator.hardwareConcurrency);
			for (let i = 0; i < count; i++) {
				const worker = new Worker(options.workerScript);
				const slot: Slot = { worker, index: null };
				this.slots.push(slot);
				this.available.push(slot);
				worker.onmessage = (event: MessageEvent<EncodedFrame>) =>
					this.receive(slot, event.data);
				worker.onerror = () => this.abort(new Error("GIF encoding worker failed"));
				worker.onmessageerror = () =>
					this.abort(new Error("Could not read encoded GIF frame"));
			}
		} catch (error) {
			this.abort(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	/** Await each call before rendering the next frame. Backpressure happens before
	 * canvas readback, and transferred pixel buffers are owned by at most eight workers. */
	async addFrame(source: HTMLCanvasElement, delay: number): Promise<void> {
		this.checkOpen();
		const slot =
			this.available.pop() ??
			(await new Promise<Slot>((resolve, reject) => {
				this.waiters.push({ resolve, reject });
			}));
		this.checkOpen();
		try {
			// Match gif.js's opaque black backing, including partially transparent
			// renderer output; GIF alpha is disabled by the existing export contract.
			this.context.fillStyle = "#000000";
			this.context.fillRect(0, 0, this.options.width, this.options.height);
			this.context.drawImage(source, 0, 0);
			const data = this.context.getImageData(
				0,
				0,
				this.options.width,
				this.options.height,
			).data;
			const index = this.submitted++;
			slot.index = index;
			slot.timer = setTimeout(
				() => this.abort(new Error("GIF frame encoding timed out")),
				FRAME_TIMEOUT_MS,
			);
			slot.worker.postMessage(
				{
					index,
					last: false,
					width: this.options.width,
					height: this.options.height,
					delay,
					transparent: null,
					repeat: this.options.repeat,
					quality: 10,
					dither: "FloydSteinberg",
					globalPalette: false,
					canTransfer: true,
					data,
				},
				[data.buffer],
			);
		} catch (error) {
			this.abort(error instanceof Error ? error : new Error(String(error)));
			throw this.failure;
		}
	}

	async finish(): Promise<Blob> {
		this.checkOpen();
		this.finishing = true;
		if (this.submitted === 0) {
			this.abort(new Error("No frames available to export"));
			throw this.failure;
		}
		if (this.completed !== this.submitted) {
			await new Promise<void>((resolve, reject) => {
				this.drain = { resolve, reject };
			});
		}
		if (this.failure) throw this.failure;
		// Only index zero writes the header. Each worker writes a frame without a
		// trailer; append one here after all frames, regardless of estimated duration.
		const blob = new Blob([...this.parts, new Uint8Array([0x3b])], { type: "image/gif" });
		this.dispose();
		return blob;
	}

	abort(error: Error = new DOMException("GIF export cancelled", "AbortError")): void {
		if (this.disposed) return;
		this.failure = error;
		for (const waiter of this.waiters.splice(0)) waiter.reject(error);
		this.drain?.reject(error);
		this.drain = undefined;
		this.dispose();
	}

	private receive(slot: Slot, frame: EncodedFrame): void {
		if (this.disposed) return;
		try {
			if (
				slot.index === null ||
				frame.index !== slot.index ||
				!Array.isArray(frame.data) ||
				frame.data.length === 0 ||
				!Number.isInteger(frame.cursor) ||
				frame.cursor < 0 ||
				!Number.isInteger(frame.pageSize) ||
				frame.pageSize < 1 ||
				frame.cursor > frame.pageSize
			)
				throw new Error("Invalid encoded GIF frame");
			const chunks = frame.data.map((page, index) => {
				if (!(page instanceof Uint8Array) || page.byteLength !== frame.pageSize)
					throw new Error("Invalid encoded GIF frame data");
				return index === frame.data.length - 1 ? page.subarray(0, frame.cursor) : page;
			});
			this.parts[frame.index] = new Blob(chunks);
			clearTimeout(slot.timer);
			slot.index = null;
			this.completed++;
			const waiter = this.waiters.shift();
			if (waiter) waiter.resolve(slot);
			else this.available.push(slot);
			this.options.onFrameEncoded?.(this.completed);
			if (this.completed === this.submitted) {
				this.drain?.resolve();
				this.drain = undefined;
			}
		} catch (error) {
			this.abort(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private checkOpen(): void {
		if (this.failure) throw this.failure;
		if (this.disposed || this.finishing) throw new Error("GIF encoder is closed");
	}

	private dispose(): void {
		this.disposed = true;
		for (const slot of this.slots) {
			clearTimeout(slot.timer);
			slot.worker.terminate();
		}
		this.slots = [];
		this.available = [];
		this.parts = [];
		this.canvas.width = this.canvas.height = 0;
	}
}
