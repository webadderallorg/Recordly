/** Main owns capture lifetime; losing the HUD must not orphan a helper. */
export type CaptureStopResult = {
	success: boolean;
	path?: string;
	error?: string;
	message?: string;
};
type Owner = Pick<Electron.WebContents, "id" | "on" | "removeListener">;
export class RecordingOwnerRecovery {
	private owner: Owner | null = null;
	private session = {};
	get sessionToken() {
		return this.session;
	}
	private userRecording = false;
	private starting: Promise<unknown> = Promise.resolve();
	private stopping: Promise<CaptureStopResult> | null = null;
	private stopped: CaptureStopResult | null = null;
	private endedUserRecording = false;
	private recovering = false;
	private recoveryTask: Promise<void> | null = null;
	private unwatch: () => void = () => undefined;
	constructor(
		private deps: {
			stop: () => Promise<CaptureStopResult>;
			finish: (result: CaptureStopResult) => Promise<CaptureStopResult>;
			needsFinish?: () => boolean;
			discard: (path: string) => Promise<void>;
			reset: () => void;
			report: (result: CaptureStopResult) => Promise<void>;
		},
	) {}
	async start<T>(
		owner: Owner,
		start: () => Promise<T>,
	): Promise<T | { success: false; message: string }> {
		// A replacement renderer can ask to record while its lost predecessor is
		// still saving. Join that cleanup instead of leaving it with a stale error.
		if (this.recoveryTask) {
			let lost = false;
			const gone = () => {
				lost = true;
			};
			const navigation = (
				event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
			) => {
				if (event.isMainFrame && !event.isSameDocument) gone();
			};
			owner.on("destroyed", gone);
			owner.on("render-process-gone", gone);
			owner.on("did-start-navigation", navigation);
			try {
				await this.recoveryTask;
			} finally {
				owner.removeListener("destroyed", gone);
				owner.removeListener("render-process-gone", gone);
				owner.removeListener("did-start-navigation", navigation);
			}
			if (lost)
				return {
					success: false,
					message: "The recording controls closed before recording could start.",
				};
		}
		if (this.deps.needsFinish?.())
			return { success: false, message: "The previous recording is still finalizing." };
		if (this.owner && this.stopped && !this.userRecording && !this.recovering) this.release();
		if (this.recovering || this.owner)
			return { success: false, message: "A recording is already starting or active." };
		this.owner = owner;
		this.session = {};
		this.userRecording = false;
		this.stopped = null;
		this.stopping = null;
		const gone = () => {
			void this.recoverOwner(owner.id).catch((error) =>
				console.error("Recording owner recovery failed", error),
			);
		};
		const navigation = (
			event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
		) => {
			if (event.isMainFrame && !event.isSameDocument) gone();
		};
		owner.on("render-process-gone", gone);
		owner.on("destroyed", gone);
		owner.on("did-start-navigation", navigation);
		this.unwatch = () => {
			owner.removeListener("render-process-gone", gone);
			owner.removeListener("destroyed", gone);
			owner.removeListener("did-start-navigation", navigation);
		};
		// Defer invocation so even a synchronous owner-loss event observes the pending start.
		const pending = Promise.resolve().then(start);
		this.starting = pending;
		try {
			const result = await pending;
			if (
				result &&
				typeof result === "object" &&
				"success" in result &&
				result.success === false &&
				!this.recovering
			)
				this.release();
			return result;
		} catch (error) {
			if (!this.recovering) this.release();
			throw error;
		}
	}
	/** React remounts can lose the controls without a WebContents navigation. */
	recoverOwner(ownerId: number): Promise<void> {
		if (this.owner?.id !== ownerId) return Promise.resolve();
		if (!this.recoveryTask) this.recoveryTask = this.recover();
		return this.recoveryTask;
	}
	setUserRecording(recording: boolean, ownerId?: number) {
		if (this.owner && (ownerId === undefined || this.owner.id === ownerId))
			this.userRecording = recording;
	}
	stop() {
		if (this.stopping) return this.stopping;
		this.endedUserRecording = this.userRecording;
		this.stopping = Promise.resolve()
			.then(() => this.deps.stop())
			.then((result) => {
				// Failed stops can leave the helper alive; the bin must be able to retry.
				this.stopped = result.success ? result : null;
				if (!result.success) this.stopping = null;
				return result;
			})
			.catch((error) => {
				this.stopping = null;
				throw error;
			});
		return this.stopping;
	}
	captureExited() {
		// Unexpected helper termination is already surfaced by platform lifecycle handlers.
		// Releasing here prevents a later HUD close from discarding recovered footage.
		if (!this.stopping && !this.recovering) this.release();
	}

	complete(token = this.session) {
		if (
			!this.recovering &&
			token === this.session &&
			this.stopped &&
			!this.userRecording &&
			!this.deps.needsFinish?.()
		)
			this.release();
	}
	private release() {
		this.unwatch();
		this.owner = null;
		this.userRecording = false;
		this.stopping = null;
		this.stopped = null;
	}
	private async recover() {
		if (this.recovering || !this.owner) return;
		this.recovering = true;
		this.unwatch();
		let reportResult: CaptureStopResult | undefined;
		try {
			await this.starting.catch(() => undefined);
			const actualRecording = this.stopping ? this.endedUserRecording : this.userRecording;
			// Closing the HUD after a completed manual stop is normal. Windows can
			// still have a main-process finishing step waiting on its renderer.
			if (
				actualRecording &&
				this.stopped?.success &&
				!this.userRecording &&
				!this.deps.needsFinish?.()
			)
				return;
			let result: CaptureStopResult;
			try {
				result = this.stopped || (await this.stop());
			} catch (error) {
				result = { success: false, error: String(error) };
			}
			if (!actualRecording) {
				if (result.success && result.path) await this.deps.discard(result.path);
			} else {
				try {
					if (result.success) result = await this.deps.finish(result);
				} catch (error) {
					result = { ...result, success: false, error: String(error) };
				}
				reportResult = result;
			}
		} finally {
			try {
				this.deps.reset();
			} finally {
				this.release();
				this.recovering = false;
				this.recoveryTask = null;
			}
		}
		// A dialog may stay open indefinitely. Its dismissal must neither hold the
		// capture reservation nor clear state belonging to a subsequent recording.
		if (reportResult) {
			const result = reportResult;
			void Promise.resolve()
				.then(() => this.deps.report(result))
				.catch((error) => console.error("Recording recovery notification failed", error));
		}
	}
}
