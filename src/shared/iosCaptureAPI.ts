import type { CommittedIOSRecording, IOSCaptureSnapshot, IOSRecordingOptions } from "./iosCapture";

export interface IOSRecoveryCandidate {
	sessionId: string;
	status: "recoverable-av" | "recoverable-video" | "unrecoverable";
	durationMs: number | null;
	reasonCode: string;
}
export interface IOSCaptureAPI {
	getCapabilities(): Promise<{ enabled: boolean }>;
	getSnapshot(): Promise<IOSCaptureSnapshot>;
	discover(): Promise<IOSCaptureSnapshot>;
	prepare(input: {
		deviceToken: string;
		generation: number;
		options: IOSRecordingOptions;
	}): Promise<IOSCaptureSnapshot>;
	start(sessionId: string): Promise<IOSCaptureSnapshot>;
	stop(sessionId: string): Promise<CommittedIOSRecording>;
	cancel(sessionId: string, discardAcceptedMedia: boolean): Promise<void>;
	release(sessionId: string): Promise<void>;
	setPreviewEnabled(enabled: boolean): Promise<void>;
	setDiscoveryActive(active: boolean): Promise<void>;
	onState(callback: (state: IOSCaptureSnapshot) => void): () => void;
	onPreview(
		callback: (frame: { generation: number; sequence: number; jpeg: Uint8Array }) => void,
	): () => void;
	getRecoveryCandidates(): Promise<readonly IOSRecoveryCandidate[]>;
	recover(sessionId: string, mode: "with-audio" | "video-only"): Promise<CommittedIOSRecording>;
	openRecoveryFolder(sessionId: string): Promise<void>;
	discardRecovery(sessionId: string): Promise<void>;
	exportDiagnostics(sessionId: string): Promise<void>;
}
