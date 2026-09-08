import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
	parseIOSCaptureEvent,
	parseNativeIOSCaptureCommand,
	type IOSCaptureEvent,
} from "../../../../src/shared/iosCapture";
import { PreviewFrameDecoder, type IOSPreviewFrame } from "./preview";
import { NDJSONDecoder } from "./protocol";

export interface IOSHelperRequest {
	command: string;
	sessionId?: string;
	generation?: number;
	payload?: Record<string, unknown>;
	storage?: { sessionRoot: string; allowedRelativeNames: readonly string[] };
}

export interface IOSHelperTransport {
	request(input: IOSHelperRequest): Promise<IOSCaptureEvent>;
	onEvent(listener: (event: IOSCaptureEvent) => void): () => void;
	onExit(listener: (error: Error) => void): () => void;
	onPreview(listener: (frame: IOSPreviewFrame) => void): () => void;
	onWarning?(listener: (code: string) => void): () => void;
	shutdown(): Promise<void>;
}

export class IOSHelperProcess implements IOSHelperTransport {
	private child: ChildProcess;
	private events = new Set<(event: IOSCaptureEvent) => void>();
	private exits = new Set<(error: Error) => void>();
	private previews = new Set<(frame: IOSPreviewFrame) => void>();
	private warnings = new Set<(code: string) => void>();
	private previewFailed = false;
	private pending = new Map<
		string,
		{
			resolve: (event: IOSCaptureEvent) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private closed = false;
	private intentionalExit = false;
	private lastSequence = -1;
	private shutdownPromise?: Promise<void>;
	private exitPromise: Promise<void>;
	private failure?: Error;
	private latestPreview?: IOSPreviewFrame;
	private previewTick?: ReturnType<typeof setImmediate>;
	/** Only the bounded byte count is retained; native diagnostics may contain private labels. */
	diagnosticBytes = 0;

	constructor(
		private readonly options: {
			binaryPath: string;
			args?: readonly string[];
			requestTimeoutMs?: number;
		},
	) {
		this.child = spawn(options.binaryPath, [...(options.args ?? [])], {
			shell: false,
			stdio: ["pipe", "pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		const decoder = new NDJSONDecoder((line) => parseIOSCaptureEvent(JSON.parse(line)));
		const preview = new PreviewFrameDecoder();
		this.child.stdout?.on("data", (bytes: Buffer) => {
			try {
				for (const event of decoder.push(bytes)) this.receive(event);
			} catch {
				this.fail(new Error("PROTOCOL_MISMATCH"));
				this.child.kill();
			}
		});
		this.child.stderr?.on("data", (bytes: Buffer) => {
			this.diagnosticBytes = Math.min(8192, this.diagnosticBytes + bytes.length);
		});
		(this.child.stdio[3] as Readable | null)?.on("data", (bytes: Buffer) => {
			try {
				for (const frame of preview.push(bytes)) this.latestPreview = frame;
				if (!this.previewTick && this.latestPreview) {
					this.previewTick = setImmediate(() => {
						this.previewTick = undefined;
						const frame = this.latestPreview;
						this.latestPreview = undefined;
						if (frame) for (const listener of this.previews) listener(frame);
					});
				}
			} catch {
				// Invalid previews are disposable. Continue draining fd3 and control/media.
				this.latestPreview = undefined;
				if (!this.previewFailed) {
					this.previewFailed = true;
					for (const listener of this.warnings) listener("PREVIEW_UNAVAILABLE");
				}
			}
		});
		this.child.stdin?.on("error", () => this.fail(new Error("HELPER_EXITED")));
		this.child.on("error", () => this.fail(new Error("HELPER_UNAVAILABLE")));
		this.exitPromise = new Promise((resolve) => {
			this.child.once("close", () => {
				this.closed = true;
				if (this.previewTick) clearImmediate(this.previewTick);
				this.latestPreview = undefined;
				try {
					decoder.finish();
				} catch {
					this.fail(new Error("PROTOCOL_MISMATCH"));
				}
				if (!this.failure) this.fail(new Error("HELPER_EXITED"));
				resolve();
			});
		});
	}

	private fail(error: Error) {
		for (const command of this.pending.values()) {
			clearTimeout(command.timer);
			command.reject(error);
		}
		this.pending.clear();
		if (!this.failure) {
			this.failure = error;
			if (!this.intentionalExit) for (const listener of this.exits) listener(error);
		}
	}

	private receive(event: IOSCaptureEvent) {
		if (event.sequence <= this.lastSequence) return;
		this.lastSequence = event.sequence;
		if (event.requestId && (event.event === "accepted" || event.event === "error")) {
			const command = this.pending.get(event.requestId);
			if (command) {
				clearTimeout(command.timer);
				this.pending.delete(event.requestId);
				if (event.event === "error") command.reject(new Error(event.payload.code));
				else command.resolve(event);
			}
		}
		for (const listener of this.events) listener(event);
	}

	async request(input: IOSHelperRequest): Promise<IOSCaptureEvent> {
		if (this.closed || this.failure) throw this.failure ?? new Error("HELPER_EXITED");
		if (this.pending.size >= 8) throw new Error("RECORDING_BUSY");
		const requestId = randomUUID();
		const command = parseNativeIOSCaptureCommand({ protocolVersion: 1, requestId, ...input });
		const encoded = JSON.stringify(command) + "\n";
		if (Buffer.byteLength(encoded) > 64 * 1024) throw new Error("INVALID_REQUEST");
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error("HELPER_UNAVAILABLE"));
			}, this.options.requestTimeoutMs ?? 10_000);
			this.pending.set(requestId, { resolve, reject, timer });
			this.child.stdin?.write(encoded, (error) => {
				if (error) this.fail(new Error("HELPER_EXITED"));
			});
		});
	}

	onEvent(listener: (event: IOSCaptureEvent) => void) {
		this.events.add(listener);
		return () => {
			this.events.delete(listener);
		};
	}
	onExit(listener: (error: Error) => void) {
		this.exits.add(listener);
		return () => {
			this.exits.delete(listener);
		};
	}
	onPreview(listener: (frame: IOSPreviewFrame) => void) {
		this.previews.add(listener);
		return () => {
			this.previews.delete(listener);
		};
	}
	onWarning(listener: (code: string) => void) {
		this.warnings.add(listener);
		return () => {
			this.warnings.delete(listener);
		};
	}

	shutdown(): Promise<void> {
		if (this.shutdownPromise) return this.shutdownPromise;
		this.intentionalExit = true;
		this.shutdownPromise = (async () => {
			if (this.closed) return;
			// EOF is a native safe-finalisation request even when control output has failed.
			this.child.stdin?.end();
			const graceful = setTimeout(() => this.child.kill("SIGTERM"), 10_000);
			const forced = setTimeout(() => this.child.kill("SIGKILL"), 12_000);
			try {
				await this.exitPromise;
			} finally {
				clearTimeout(graceful);
				clearTimeout(forced);
			}
		})();
		return this.shutdownPromise;
	}
}
