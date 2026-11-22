import {
	ENCODER_PROGRESS_TIMEOUT_MS,
	NATIVE_WRITE_BATCH_MAX_BYTES,
	NATIVE_WRITE_BATCH_MAX_CHUNKS,
} from "./modernExportConstants";

import type { ModernExportSession } from "./modernExportSession";

/** Owns encoder backpressure and native write batches. */
type Session = Pick<
	ModernExportSession,
	"browser" | "cancelled" | "metrics" | "native" | "throwIfCancelled"
>;

export class ModernExportFlowControl {
	encodeQueue = 0;
	webCodecsEncodeQueueLimit = 0;
	keyFrameInterval = 0;
	pendingMuxing: Promise<void> = Promise.resolve();
	chunkCount = 0;
	nativeWritePromises = new Set<Promise<void>>();
	nativeWriteError: Error | null = null;
	pendingNativeWriteChunks: Uint8Array[] = [];
	pendingNativeWriteBytes = 0;
	maxNativeWriteInFlight = 1;
	encodeCapacityWaiters = new Set<() => void>();
	resetEncoder(): void {
		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.chunkCount = 0;
		this.webCodecsEncodeQueueLimit = 0;
		this.keyFrameInterval = 0;
	}
	constructor(
		private readonly session: Session,
		private readonly now: () => number,
	) {}

	reset(): void {
		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.chunkCount = 0;
		this.nativeWritePromises = new Set();
		this.nativeWriteError = null;
		this.pendingNativeWriteChunks = [];
		this.pendingNativeWriteBytes = 0;
		this.maxNativeWriteInFlight = 1;
		this.notifyEncodeCapacityAvailable();
		this.encodeCapacityWaiters.clear();
	}

	queueNativeWriteChunk(sessionId: string, chunk: Uint8Array): void {
		this.pendingNativeWriteChunks.push(chunk);
		this.pendingNativeWriteBytes += chunk.byteLength;

		if (
			this.pendingNativeWriteChunks.length >= NATIVE_WRITE_BATCH_MAX_CHUNKS ||
			this.pendingNativeWriteBytes >= NATIVE_WRITE_BATCH_MAX_BYTES
		) {
			this.flushPendingNativeWriteBatch(sessionId);
		}
	}

	flushPendingNativeWriteBatch(sessionId: string): void {
		if (this.pendingNativeWriteChunks.length === 0) {
			return;
		}

		const chunks = this.pendingNativeWriteChunks;
		this.pendingNativeWriteChunks = [];
		this.pendingNativeWriteBytes = 0;
		const writeStarted = this.now();
		const writePromise = window.electronAPI
			.nativeVideoExportWriteFrames(sessionId, chunks)
			.then((writeResult) => {
				if (!writeResult.success && !this.session.cancelled) {
					throw new Error(
						writeResult.error || "Failed to write H.264 chunks to native encoder",
					);
				}
			})
			.catch((error) => {
				if (
					!this.session.cancelled &&
					this.session.native.nativeExportSessionId === sessionId
				) {
					const resolvedError = error instanceof Error ? error : new Error(String(error));
					if (!this.session.native.nativeEncoderError) {
						this.session.native.nativeEncoderError = resolvedError;
					}
					if (!this.nativeWriteError) {
						this.nativeWriteError = resolvedError;
					}
				}
				throw error;
			})
			.finally(() => {
				if (this.session.native.nativeExportSessionId === sessionId)
					this.session.metrics.nativeWriteTimeMs += this.now() - writeStarted;
			});

		this.trackNativeWritePromise(writePromise);
		this.notifyEncodeCapacityAvailable();
	}

	waitForEncodeCapacity(): Promise<void> {
		return new Promise((resolve) => {
			// Dequeue and output notifications are independent; periodically recheck even
			// if a browser omits an event. Callers bound idle time separately.
			const wake = () => {
				clearTimeout(timer);
				this.encodeCapacityWaiters.delete(wake);
				resolve();
			};
			const timer = setTimeout(wake, 50);
			this.encodeCapacityWaiters.add(wake);
		});
	}

	notifyEncodeCapacityAvailable(): void {
		if (this.encodeCapacityWaiters.size === 0) {
			return;
		}

		const waiters = [...this.encodeCapacityWaiters];
		this.encodeCapacityWaiters.clear();
		for (const resolve of waiters) {
			resolve();
		}
	}

	getCurrentEncodeBacklog(): number {
		return Math.max(
			this.session.browser.encoder?.encodeQueueSize ?? 0,
			this.session.native.nativeH264Encoder?.encodeQueueSize ?? 0,
			this.encodeQueue,
		);
	}

	trackNativeWritePromise(writePromise: Promise<void>): void {
		this.nativeWritePromises.add(writePromise);
		this.session.metrics.peakNativeWriteInFlight = Math.max(
			this.session.metrics.peakNativeWriteInFlight,
			this.nativeWritePromises.size,
		);

		const removeWrite = () => {
			this.nativeWritePromises.delete(writePromise);
			this.notifyEncodeCapacityAvailable();
		};
		void writePromise.then(removeWrite, removeWrite);
	}

	async awaitOldestNativeWrite(): Promise<void> {
		const oldestWritePromise = this.nativeWritePromises.values().next().value;
		if (!oldestWritePromise) {
			return;
		}

		const startedAt = this.now();
		while (this.nativeWritePromises.has(oldestWritePromise) && !this.session.cancelled) {
			await this.waitForEncodeCapacity();
			if (this.now() - startedAt >= ENCODER_PROGRESS_TIMEOUT_MS) {
				throw new Error("Native export frame write made no progress for 30 seconds");
			}
		}
		this.session.throwIfCancelled();
		await oldestWritePromise;

		if (this.nativeWriteError) {
			throw this.nativeWriteError;
		}
	}

	async awaitPendingNativeWrites(): Promise<void> {
		while (this.nativeWritePromises.size > 0) {
			await this.awaitOldestNativeWrite();
		}

		if (this.nativeWriteError) {
			throw this.nativeWriteError;
		}
	}
}
