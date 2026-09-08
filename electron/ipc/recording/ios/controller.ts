import { randomUUID } from "node:crypto";
import {
	IOS_CAPTURE_ERROR_CODES,
	type CommittedIOSRecording,
	type IOSCaptureEvent,
	type IOSCaptureSnapshot,
	type IOSRecordingOptions,
	type NativeCaptureResult,
} from "../../../../src/shared/iosCapture";
import {
	acquireRecordingLease,
	releaseRecordingLease,
	type RecordingLease,
} from "../recordingLease";
import type { IOSHelperTransport } from "./helperProcess";
import type { IOSPreviewFrame } from "./preview";
import type { IOSCaptureJournal, IOSSessionStorage } from "./storage";

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
}
function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	void promise.catch(() => {
		/* Failure is retained by the authoritative controller. */
	});
	return { promise, resolve, reject };
}

export interface IOSControllerDependencies {
	enabled: boolean;
	createHelper: () => Promise<IOSHelperTransport>;
	allocate: (sessionId: string) => Promise<IOSSessionStorage>;
	permissions: (options: IOSRecordingOptions) => Promise<void>;
	finalize: (
		storage: IOSSessionStorage,
		result: NativeCaptureResult,
		signal?: AbortSignal,
	) => Promise<CommittedIOSRecording>;
	discard: (storage: IOSSessionStorage) => Promise<void>;
	onCommitted: (recording: CommittedIOSRecording) => void | Promise<void>;
	journal?: (storage: IOSSessionStorage, patch: Partial<IOSCaptureJournal>) => Promise<void>;
	checkSpace?: (storage: IOSSessionStorage, elapsedMs: number) => Promise<boolean>;
	setCapturing?: (capturing: boolean) => void;
	shutdownGraceMs?: number;
}

export function initialIOSCaptureSnapshot(enabled: boolean): IOSCaptureSnapshot {
	return {
		sequence: 0,
		generation: 0,
		sessionId: null,
		phase: enabled ? "idle" : "unavailable",
		devices: [],
		microphones: [],
		source: null,
		options: null,
		format: null,
		mode: null,
		elapsedMs: 0,
		acceptedVideoSamples: 0,
		warningCodes: [],
		error: null,
	};
}

/** The sole owner of capture state, terminal work, and renderer-independent handoff. */
export class IOSCaptureController {
	private state: IOSCaptureSnapshot;
	private listeners = new Set<(state: IOSCaptureSnapshot) => void>();
	private previewListeners = new Set<(frame: IOSPreviewFrame) => void>();
	private helper?: IOSHelperTransport;
	private helperPromise?: Promise<IOSHelperTransport>;
	private helperEpoch = 0;
	private preparationRevision = 0;
	private closingHelper?: Promise<void>;
	private cleanupHelper: Array<() => void> = [];
	private lastEvent = -1;
	private lease?: RecordingLease;
	private storage?: IOSSessionStorage;
	private inventoryWait?: Deferred<IOSCaptureSnapshot>;
	private prepareWait?: Deferred<IOSCaptureSnapshot>;
	private startWait?: Deferred<IOSCaptureSnapshot>;
	private terminal?: Deferred<CommittedIOSRecording>;
	private finalization?: Promise<void>;
	private finalizationAbort?: AbortController;
	private timer?: ReturnType<typeof setTimeout>;
	private stopSent = false;
	private stopReason = "user-stop";
	private discardRequested = false;
	private previewSequence = -1;
	private checkingSpace = false;
	private committed?: CommittedIOSRecording;

	constructor(private readonly deps: IOSControllerDependencies) {
		this.state = initialIOSCaptureSnapshot(deps.enabled);
	}
	getSnapshot(): IOSCaptureSnapshot {
		return structuredClone(this.state);
	}
	getCommitted(): CommittedIOSRecording | undefined {
		return this.committed;
	}
	subscribe(listener: (state: IOSCaptureSnapshot) => void) {
		this.listeners.add(listener);
		listener(this.getSnapshot());
		return () => {
			this.listeners.delete(listener);
		};
	}
	onPreview(listener: (frame: IOSPreviewFrame) => void) {
		this.previewListeners.add(listener);
		return () => {
			this.previewListeners.delete(listener);
		};
	}
	private update(patch: Partial<IOSCaptureSnapshot>) {
		this.state = { ...this.state, ...patch, sequence: this.state.sequence + 1 };
		for (const listener of this.listeners) listener(this.getSnapshot());
	}
	private assertEnabled() {
		if (!this.deps.enabled) throw new Error("UNSUPPORTED_PLATFORM");
	}
	private assertSession(id: string) {
		if (!id || id !== this.state.sessionId) throw new Error("INVALID_REQUEST");
	}
	private clearTimer() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}
	private releaseLease() {
		if (!this.lease) return;
		releaseRecordingLease(this.lease);
		this.lease = undefined;
		this.deps.setCapturing?.(false);
	}
	private armTimeout(code: string) {
		this.clearTimer();
		this.timer = setTimeout(() => {
			this.fail(new Error(code));
			void this.closeHelper();
		}, 10_000);
	}
	private fail(error: Error) {
		this.preparationRevision++;
		this.clearTimer();
		this.prepareWait?.reject(error);
		this.prepareWait = undefined;
		this.startWait?.reject(error);
		this.startWait = undefined;
		this.inventoryWait?.reject(error);
		this.inventoryWait = undefined;
		this.terminal?.reject(error);
		const code =
			IOS_CAPTURE_ERROR_CODES.find((candidate) => candidate === error.message) ??
			"HELPER_EXITED";
		this.update({
			phase: this.state.acceptedVideoSamples ? "recoveryAvailable" : "failed",
			error: { code, recoverable: !!this.storage },
		});
		void this.closeHelper().finally(() => this.releaseLease());
		if (this.storage)
			void this.deps.journal?.(this.storage, { state: "interrupted" }).catch(() => {
				/* Failure is retained by the authoritative controller. */
			});
	}
	private async ensureHelper(): Promise<IOSHelperTransport> {
		if (this.closingHelper) await this.closingHelper;
		if (this.helperPromise) return this.helperPromise;
		const epoch = this.helperEpoch;
		this.helperPromise = (async () => {
			const helper = await this.deps.createHelper();
			if (epoch !== this.helperEpoch) {
				await helper.shutdown();
				throw new Error("HELPER_UNAVAILABLE");
			}
			this.helper = helper;
			this.lastEvent = -1;
			this.cleanupHelper = [
				helper.onEvent((event) => this.receive(event)),
				helper.onExit((error) => {
					this.fail(error);
					void this.closeHelper();
				}),
				helper.onPreview((frame) => {
					if (
						frame.generation !== this.state.generation ||
						frame.sequence <= this.previewSequence
					)
						return;
					this.previewSequence = frame.sequence;
					for (const listener of this.previewListeners) listener(frame);
				}),
				helper.onWarning?.((code) =>
					this.update({
						warningCodes: [...new Set([...this.state.warningCodes, code])].slice(-32),
					}),
				) ?? (() => undefined),
			];
			await helper.request({ command: "hello" });
			return helper;
		})();
		return this.helperPromise;
	}
	private async closeHelper() {
		if (this.closingHelper) return this.closingHelper;
		this.helperEpoch++;
		const helper = this.helper;
		const pending = this.helperPromise;
		this.helper = undefined;
		this.helperPromise = undefined;
		for (const cleanup of this.cleanupHelper.splice(0)) cleanup();
		this.update({ devices: [], microphones: [] });
		this.closingHelper = helper
			? helper.shutdown()
			: pending
				? pending.then(
						() => undefined,
						() => undefined,
					)
				: Promise.resolve();
		try {
			await this.closingHelper;
		} finally {
			this.closingHelper = undefined;
		}
	}
	async discover(): Promise<IOSCaptureSnapshot> {
		this.assertEnabled();
		if (this.inventoryWait) return this.inventoryWait.promise;
		this.inventoryWait = deferred();
		const waiting = this.inventoryWait;
		if (["idle", "failed", "unavailable", "completed", "cancelled"].includes(this.state.phase))
			this.update({ phase: "discovering", error: null });
		try {
			const helper = await this.ensureHelper();
			await helper.request({ command: "discover" });
			// Discovery may settle asynchronously; the native reconciliation keeps emitting later changes.
			const timeout = setTimeout(() => {
				if (this.inventoryWait === waiting) {
					this.inventoryWait = undefined;
					this.update({
						phase: this.state.phase === "discovering" ? "idle" : this.state.phase,
					});
					waiting.resolve(this.getSnapshot());
				}
			}, 10_000);
			try {
				return await waiting.promise;
			} finally {
				clearTimeout(timeout);
			}
		} catch (error) {
			this.fail(error as Error);
			throw error;
		}
	}
	async prepare(input: {
		deviceToken: string;
		generation: number;
		options: IOSRecordingOptions;
	}): Promise<IOSCaptureSnapshot> {
		this.assertEnabled();
		if (
			this.closingHelper ||
			["preparing", "starting", "recording", "stopping", "finalising"].includes(
				this.state.phase,
			)
		)
			throw new Error("RECORDING_BUSY");
		const source = this.state.devices.find(
			(device) =>
				device.deviceToken === input.deviceToken && device.generation === input.generation,
		);
		if (!source) throw new Error("DEVICE_NOT_FOUND");
		if (
			input.options.microphoneToken &&
			!this.state.microphones.some((mic) => mic.token === input.options.microphoneToken)
		)
			throw new Error("DEVICE_NOT_FOUND");
		const previousSessionId = this.state.phase === "ready" ? this.state.sessionId : null;
		if (!previousSessionId) this.lease = acquireRecordingLease("ios-device");
		const revision = ++this.preparationRevision;
		const assertPreparing = () => {
			if (revision !== this.preparationRevision || this.state.phase !== "preparing")
				throw new Error("INVALID_REQUEST");
		};
		this.stopSent = false;
		this.stopReason = "user-stop";
		this.discardRequested = false;
		this.finalization = undefined;
		this.committed = undefined;
		this.terminal = deferred();
		this.prepareWait = deferred();
		const waiting = this.prepareWait;
		this.previewSequence = -1;
		const sessionId = randomUUID();
		this.storage = undefined;
		this.update({
			phase: "preparing",
			generation: this.state.generation + 1,
			sessionId,
			source,
			options: input.options,
			format: null,
			mode: null,
			acceptedVideoSamples: 0,
			elapsedMs: 0,
			warningCodes: [],
			error: null,
		});
		try {
			if (previousSessionId) {
				// Retain the helper and lease across input release so inventory tokens stay valid.
				await this.helper?.request({ command: "release", sessionId: previousSessionId });
				assertPreparing();
			}
			await this.deps.permissions(input.options);
			assertPreparing();
			const storage = await this.deps.allocate(sessionId);
			if (revision !== this.preparationRevision) {
				await this.deps.discard(storage);
				throw new Error("INVALID_REQUEST");
			}
			assertPreparing();
			this.storage = storage;
			const helper = await this.ensureHelper();
			assertPreparing();
			this.armTimeout("NO_VIDEO_SAMPLES");
			await helper.request({
				command: "prepare",
				sessionId,
				generation: this.state.generation,
				payload: {
					deviceToken: input.deviceToken,
					inventoryGeneration: input.generation,
					options: input.options,
				},
				storage: {
					sessionRoot: this.storage.directory,
					allowedRelativeNames: [
						"source-video.mov",
						"device-audio.mov",
						"microphone.mov",
						"native-timing.json",
					],
				},
			});
			return await waiting.promise;
		} catch (error) {
			if (revision === this.preparationRevision) {
				this.fail(error as Error);
				await this.closeHelper();
			}
			throw error;
		}
	}
	async setPreviewEnabled(enabled: boolean): Promise<void> {
		if (!this.state.sessionId || !this.helper || this.state.phase === "preparing") return;
		await this.helper.request({
			command: "setPreviewEnabled",
			sessionId: this.state.sessionId,
			generation: this.state.generation,
			payload: { enabled },
		});
	}
	start(sessionId: string): Promise<IOSCaptureSnapshot> {
		this.assertSession(sessionId);
		if (this.state.phase !== "ready" || !this.helper || !this.storage)
			return Promise.reject(new Error("INVALID_REQUEST"));
		this.startWait = deferred();
		const waiting = this.startWait;
		this.update({ phase: "starting", acceptedVideoSamples: 0 });
		this.armTimeout("NO_VIDEO_SAMPLES");
		void (async () => {
			try {
				await this.deps.journal?.(this.storage!, { state: "starting" });
				if (this.state.phase !== "starting") return;
				await this.helper!.request({ command: "start", sessionId });
			} catch (error) {
				this.fail(error as Error);
				await this.closeHelper();
			}
		})();
		return waiting.promise;
	}
	stop(sessionId: string, reason = "user-stop"): Promise<CommittedIOSRecording> {
		this.assertSession(sessionId);
		if (this.stopReason === "user-stop") this.stopReason = reason;
		if (this.committed) return Promise.resolve(this.committed);
		if (
			!this.terminal ||
			!["starting", "recording", "stopping", "finalising"].includes(this.state.phase)
		)
			return Promise.reject(new Error("INVALID_REQUEST"));
		if (!this.stopSent && !this.finalization) {
			this.stopSent = true;
			this.clearTimer();
			this.startWait?.reject(new Error("NO_VIDEO_SAMPLES"));
			this.startWait = undefined;
			this.update({ phase: "stopping" });
			this.armTimeout("FINALIZATION_FAILED");
			void this.helper
				?.request({ command: "stop", sessionId })
				.catch((error) => this.fail(error));
		}
		return this.terminal.promise;
	}
	async cancel(sessionId: string, discardAcceptedMedia: boolean): Promise<void> {
		this.assertSession(sessionId);
		if (["starting", "recording", "stopping", "finalising"].includes(this.state.phase)) {
			if (!discardAcceptedMedia && this.state.acceptedVideoSamples > 0)
				throw new Error("INVALID_REQUEST");
			this.discardRequested = discardAcceptedMedia;
			try {
				await this.stop(sessionId);
			} catch (error) {
				if ((error as Error).message !== "NO_VIDEO_SAMPLES") throw error;
			}
			return;
		}
		await this.release(sessionId);
		if (discardAcceptedMedia && this.storage) await this.deps.discard(this.storage);
		this.update({ phase: "cancelled" });
	}
	async release(sessionId: string): Promise<void> {
		this.assertSession(sessionId);
		if (["starting", "recording", "stopping", "finalising"].includes(this.state.phase))
			throw new Error("RECORDING_BUSY");
		this.preparationRevision++;
		this.prepareWait?.reject(new Error("INVALID_REQUEST"));
		this.prepareWait = undefined;
		this.clearTimer();
		try {
			if (this.helper) await this.helper.request({ command: "release", sessionId });
		} finally {
			await this.closeHelper();
			this.releaseLease();
			this.update({
				phase: "idle",
				sessionId: null,
				source: null,
				options: null,
				format: null,
				mode: null,
				devices: [],
				microphones: [],
			});
		}
	}
	private receive(event: IOSCaptureEvent) {
		if (event.sequence <= this.lastEvent) return;
		this.lastEvent = event.sequence;
		if (event.event === "inventoryChanged") {
			this.update({
				devices: event.payload.devices,
				microphones: event.payload.microphones,
				phase: this.state.phase === "discovering" ? "idle" : this.state.phase,
			});
			this.inventoryWait?.resolve(this.getSnapshot());
			this.inventoryWait = undefined;
			return;
		}
		if (event.event === "accepted" || (event.event === "error" && event.requestId)) return;
		if (
			(event.sessionId && event.sessionId !== this.state.sessionId) ||
			(event.generation !== undefined && event.generation !== this.state.generation)
		)
			return;
		switch (event.event) {
			case "prepared":
				if (
					this.state.phase !== "preparing" ||
					event.payload.source.deviceToken !== this.state.source?.deviceToken
				)
					return;
				this.clearTimer();
				this.update({
					phase: "ready",
					format: event.payload.format,
					mode: event.payload.mode,
				});
				if (this.storage)
					void this.deps
						.journal?.(this.storage, {
							format: event.payload.format,
							mode: event.payload.mode,
						})
						.catch((error) => this.fail(error));
				this.prepareWait?.resolve(this.getSnapshot());
				this.prepareWait = undefined;
				break;
			case "recordingStarted":
				if (!["starting", "stopping"].includes(this.state.phase)) return;
				if (!this.stopSent) this.clearTimer();
				this.update({
					phase: this.stopSent ? "stopping" : "recording",
					acceptedVideoSamples: event.payload.acceptedVideoSamples,
				});
				this.deps.setCapturing?.(true);
				this.startWait?.resolve(this.getSnapshot());
				this.startWait = undefined;
				if (this.storage)
					void this.deps
						.journal?.(this.storage, { state: "recording" })
						.catch((error) => this.fail(error));
				break;
			case "progress":
				if (!["recording", "stopping"].includes(this.state.phase)) return;
				this.update({
					elapsedMs: event.payload.elapsedMs,
					acceptedVideoSamples: event.payload.acceptedVideoSamples,
				});
				if (this.storage && this.deps.checkSpace && !this.checkingSpace) {
					this.checkingSpace = true;
					const sessionId = this.state.sessionId;
					void this.deps
						.checkSpace(this.storage, this.state.elapsedMs)
						.then((enough) => {
							if (
								!enough &&
								sessionId === this.state.sessionId &&
								this.state.phase === "recording"
							) {
								this.update({
									warningCodes: [...this.state.warningCodes, "DISK_SPACE_LOW"],
								});
								void this.stop(sessionId!, "DISK_SPACE_LOW").catch(() => {
									/* Failure is retained by the authoritative controller. */
								});
							}
						})
						.catch(() => {
							if (sessionId && sessionId === this.state.sessionId)
								void this.stop(sessionId).catch(() => {
									/* Failure is retained by the authoritative controller. */
								});
						})
						.finally(() => {
							this.checkingSpace = false;
						});
				}
				break;
			case "warning":
				this.update({
					warningCodes: [
						...new Set([...this.state.warningCodes, event.payload.code]),
					].slice(-32),
				});
				break;
			case "nativeFinalized":
				this.finish(event.payload.result);
				break;
			case "error":
				this.fail(new Error(event.payload.code));
				break;
		}
	}
	private finish(result: NativeCaptureResult) {
		if (
			this.finalization ||
			!this.storage ||
			result.sessionId !== this.state.sessionId ||
			!["starting", "recording", "stopping"].includes(this.state.phase) ||
			result.video.sampleCount < 1
		)
			return;
		this.clearTimer();
		if (["user-stop", "stopped"].includes(result.stopReason)) {
			const reason =
				this.stopReason !== "user-stop"
					? this.stopReason
					: this.state.warningCodes.includes("AUDIO_INTERRUPTED")
						? "AUDIO_INTERRUPTED"
						: result.stopReason;
			result = { ...result, stopReason: reason };
		}
		const storage = this.storage;
		const terminal = this.terminal;
		const abort = new AbortController();
		this.finalizationAbort = abort;
		this.finalization = (async () => {
			try {
				this.update({ phase: "finalising" });
				if (this.discardRequested) {
					await this.closeHelper();
					await this.deps.discard(storage);
					this.releaseLease();
					this.update({ phase: "cancelled" });
					terminal?.reject(new Error("NO_VIDEO_SAMPLES"));
					return;
				}
				const recording = await this.deps.finalize(storage, result, abort.signal);
				if (abort.signal.aborted) throw new Error("FINALIZATION_FAILED");
				await this.closeHelper();
				await this.deps.onCommitted(recording);
				this.committed = recording;
				this.releaseLease();
				this.update({
					phase: recording.captureMetadata.interrupted ? "interrupted" : "completed",
				});
				terminal?.resolve(recording);
			} catch (error) {
				this.fail(error as Error);
			}
		})();
	}
	async shutdown(): Promise<void> {
		this.preparationRevision++;
		this.prepareWait?.reject(new Error("INVALID_REQUEST"));
		this.prepareWait = undefined;
		if (
			this.state.sessionId &&
			["starting", "recording", "stopping", "finalising"].includes(this.state.phase)
		) {
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const finished = await Promise.race([
				this.stop(this.state.sessionId, "app-quit").then(
					() => true,
					() => true,
				),
				new Promise<false>((resolve) => {
					timeout = setTimeout(() => resolve(false), this.deps.shutdownGraceMs ?? 10_000);
				}),
			]);
			if (timeout) clearTimeout(timeout);
			if (!finished) {
				this.finalizationAbort?.abort();
				this.fail(new Error("FINALIZATION_FAILED"));
			}
		}
		this.clearTimer();
		await this.closeHelper();
		this.releaseLease();
	}
}
