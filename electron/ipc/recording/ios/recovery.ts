import fs from "node:fs/promises";
import path from "node:path";
import {
	parseNativeCaptureResult,
	type CommittedIOSRecording,
	type IOSSessionId,
	type NativeCaptureResult,
	type IOSCaptureMode,
	type IOSVideoFormat,
} from "../../../../src/shared/iosCapture";
import {
	finalizeIOSRecording,
	finalizeRecoveredIOSVideo,
	readIOSNativeTiming,
	validateIOSVideoInspection,
	type IOSFinalizeDependencies,
} from "./finalize";
import {
	IOS_SESSION_UUID,
	readIOSJournal,
	repairIOSJournal,
	resolveIOSArtifact,
	validateIOSStorage,
	type IOSSessionStorage,
	type IOSCaptureJournal,
} from "./storage";
export interface IOSRecoveryCandidate {
	sessionId: IOSSessionId;
	status: "recoverable-av" | "recoverable-video" | "unrecoverable";
	durationMs: number | null;
	reasonCode: string;
}
interface Registered {
	storage: IOSSessionStorage;
	candidate: IOSRecoveryCandidate;
	result: NativeCaptureResult | null;
	needsJournalRepair?: boolean;
	recoveryMetadata?: { mode: IOSCaptureMode; format: IOSVideoFormat };
}
export class IOSRecoveryRegistry {
	private readonly sessions = new Map<IOSSessionId, Registered>();
	private readonly pending = new Map<IOSSessionId, Promise<CommittedIOSRecording>>();
	constructor(
		private readonly deps: IOSFinalizeDependencies,
		private readonly platformSupported = false,
	) {}
	async scan(
		recordingsRoot: string,
		excludedSessionIds: ReadonlySet<string> = new Set(),
	): Promise<readonly IOSRecoveryCandidate[]> {
		this.sessions.clear();
		if (!this.platformSupported) return [];
		const root = await fs.realpath(recordingsRoot);
		if ((await fs.lstat(recordingsRoot)).isSymbolicLink())
			throw new Error("UNSAFE_RECORDINGS_ROOT");
		for (const entry of await fs.readdir(root, { withFileTypes: true })) {
			const sessionId = entry.name.slice(4);
			if (
				!entry.isDirectory() ||
				!entry.name.startsWith("ios-") ||
				!IOS_SESSION_UUID.test(sessionId) ||
				excludedSessionIds.has(sessionId)
			)
				continue;
			const directory = path.join(root, entry.name);
			const storage = {
				sessionId,
				directory,
				journalPath: path.join(directory, "capture-journal.json"),
			};
			let journal: IOSCaptureJournal;
			let needsJournalRepair = false;
			try {
				journal = await readIOSJournal(storage);
			} catch {
				try {
					// Only a real validated helper terminal checkpoint can reconstruct a lost main journal.
					await resolveIOSArtifact(storage, "capture-journal.json");
					const checkpoint = JSON.parse(
						await fs.readFile(
							await resolveIOSArtifact(storage, "native-timing.json"),
							"utf8",
						),
					);
					const nativeResult = parseNativeCaptureResult(
						checkpoint.nativeResult ?? checkpoint.result,
					);
					if (nativeResult.sessionId !== sessionId) continue;
					journal = {
						version: 1,
						sessionId,
						createdAt: "",
						state: "interrupted",
						nativeResult,
						format: nativeResult.format,
						mode: nativeResult.mode,
					};
					needsJournalRepair = true;
				} catch {
					continue;
				}
			}
			if (journal.state === "committed") continue;
			let result: NativeCaptureResult | null = null;
			try {
				result = parseNativeCaptureResult(journal.nativeResult);
			} catch {
				/* Missing optional evidence must not acquire inferred values. */
			}
			let durationMs: number | null = null;
			let status: IOSRecoveryCandidate["status"] = "unrecoverable";
			let reasonCode = "INVALID_VIDEO";
			try {
				const source = await resolveIOSArtifact(storage, "source-video.mov");
				const inspection = await this.deps.inspectMedia(source);
				durationMs = validateIOSVideoInspection(inspection);
				try {
					result = parseNativeCaptureResult(journal.nativeResult);
				} catch {
					try {
						const checkpoint = JSON.parse(
							await fs.readFile(
								await resolveIOSArtifact(storage, "native-timing.json"),
								"utf8",
							),
						);
						result = parseNativeCaptureResult(
							checkpoint.nativeResult ?? checkpoint.result,
						);
					} catch {
						/* Missing optional evidence must not acquire inferred values. */
					}
				}
				if (result && result.sessionId !== sessionId) throw new Error("INVALID_SESSION");

				// Unknown original encoder mode is not guessed from the codec.
				if (!result && (!journal.mode || !journal.format)) {
					reasonCode = "PROVENANCE_UNAVAILABLE";
				} else {
					status = "recoverable-video";
					reasonCode = "TIMING_UNAVAILABLE";
					try {
						if (!result) throw new Error("TIMING_UNAVAILABLE");
						await readIOSNativeTiming(storage, result);
						const artifacts = [result.deviceAudio, result.microphone].filter((a) =>
							Boolean(a),
						);
						if (artifacts.length) {
							for (const artifact of artifacts) {
								const p = await resolveIOSArtifact(storage, artifact!.relativeName);
								const inspected = await this.deps.inspectMedia(p);
								if (!inspected.decodable || !inspected.audio)
									throw new Error("INVALID_AUDIO");
							}
							status = "recoverable-av";
							reasonCode = "INTERRUPTED";
						}
					} catch {
						/* Missing optional evidence must not acquire inferred values. */
					}
				}
			} catch {
				/* Missing optional evidence must not acquire inferred values. */
			}
			if (result && (result.deviceAudio || result.microphone)) {
				try {
					const finalPath = await resolveIOSArtifact(storage, "recording.mov");
					const finalInspection = await this.deps.inspectMedia(finalPath);
					durationMs = validateIOSVideoInspection(finalInspection, result.format);
					if (finalInspection.audio) {
						status = "recoverable-av";
						reasonCode = "FINALIZED_MOVIE_AVAILABLE";
					}
				} catch {
					/* Missing optional evidence must not acquire inferred values. */
				}
			}
			const candidate = { sessionId, status, durationMs, reasonCode };
			this.sessions.set(sessionId, {
				storage,
				candidate,
				result,
				needsJournalRepair,
				recoveryMetadata:
					journal.mode && journal.format
						? { mode: journal.mode, format: journal.format }
						: undefined,
			});
		}
		return [...this.sessions.values()].map((s) => s.candidate);
	}
	recover(input: {
		sessionId: IOSSessionId;
		mode: "with-audio" | "video-only";
	}): Promise<CommittedIOSRecording> {
		const registered = this.sessions.get(input.sessionId);
		if (
			!this.platformSupported ||
			!registered ||
			(!registered.result && !registered.recoveryMetadata) ||
			registered.candidate.status === "unrecoverable" ||
			!["with-audio", "video-only"].includes(input.mode)
		)
			return Promise.reject(new Error("INVALID_RECOVERY_REQUEST"));
		if (input.mode === "with-audio" && registered.candidate.status !== "recoverable-av")
			return Promise.reject(new Error("CLOCK_MAPPING_UNAVAILABLE"));
		const pending = this.pending.get(input.sessionId);
		if (pending) return pending;
		const result = registered.result;
		const work = (async () => {
			if (registered.needsJournalRepair && result)
				await repairIOSJournal(registered.storage, result);
			return input.mode === "video-only"
				? finalizeRecoveredIOSVideo(
						{
							storage: registered.storage,
							...(result
								? { mode: result.mode, format: result.format }
								: registered.recoveryMetadata!),
						},
						this.deps,
					)
				: finalizeIOSRecording(
						{
							storage: registered.storage,
							nativeResult: { ...result!, stopReason: "recovered-interruption" },
						},
						this.deps,
					);
		})();
		this.pending.set(input.sessionId, work);
		void work
			.then(() => this.sessions.delete(input.sessionId))
			.finally(() => this.pending.delete(input.sessionId))
			.catch(() => undefined);
		return work;
	}
	async resolveDirectory(sessionId: IOSSessionId): Promise<string> {
		const registered = this.sessions.get(sessionId);
		if (!this.platformSupported || !registered) throw new Error("INVALID_RECOVERY_REQUEST");
		await validateIOSStorage(registered.storage);
		return registered.storage.directory;
	}
	async discard(sessionId: IOSSessionId): Promise<void> {
		if (this.pending.has(sessionId)) throw new Error("RECOVERY_BUSY");
		const directory = await this.resolveDirectory(sessionId);
		await fs.rm(directory, { recursive: true, force: false });
		this.sessions.delete(sessionId);
	}
}
export function scanIOSRecoveryCandidates(
	recordingsRoot: string,
	registry: IOSRecoveryRegistry,
): Promise<readonly IOSRecoveryCandidate[]> {
	return registry.scan(recordingsRoot);
}
export function recoverIOSRecording(
	input: { sessionId: IOSSessionId; mode: "with-audio" | "video-only" },
	registry: IOSRecoveryRegistry,
): Promise<CommittedIOSRecording> {
	return registry.recover(input);
}
