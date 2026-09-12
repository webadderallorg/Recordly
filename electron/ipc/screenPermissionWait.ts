export interface ScreenPermissionWaitResult {
	success: boolean;
	cancelled?: boolean;
}

export interface ScreenPermissionWaitControllerHandlers {
	/** Called when a wait begins — show the awaiting-permission overlay. */
	onWaitStarted: () => void;
	/**
	 * Called when the wait settles.
	 * `granted: true` → clear the awaiting state and keep the overlay alive
	 * for the countdown that follows; `granted: false` → close the overlay.
	 */
	onWaitEnded: (granted: boolean) => void;
}

export interface ScreenPermissionWaitControllerOptions {
	/** Injectable clock for tests. */
	now?: () => number;
}

export interface ScreenPermissionWaitController {
	/** Starts a wait; returns null when one is already pending. */
	begin(): Promise<ScreenPermissionWaitResult> | null;
	/** Settles the pending wait; returns false when nothing is pending. */
	end(granted: boolean): boolean;
	/**
	 * Settles the pending wait as user-cancelled. Also handles an overlay
	 * click that lands AFTER the grant but BEFORE the countdown starts:
	 * arms a short-lived signal that suppresses the next countdown start so
	 * a cancelled recording cannot resume. Inert when no wait is in flight.
	 */
	cancel(): boolean;
	isPending(): boolean;
	/** Whether the overlay should render the awaiting (spinner) state. */
	isAwaitingOverlay(): boolean;
	/**
	 * Gate checked at the top of start-countdown: true when a post-grant
	 * overlay cancel is still fresh (the start must be suppressed).
	 * Consumes the signal on every check.
	 */
	consumeCountdownStartGate(): boolean;
}

/**
 * Coordinates the "waiting for screen permission" IPC flow between the
 * renderer hook and the countdown overlay window. Pure state — window and
 * IPC wiring are injected by the caller.
 */
export function createScreenPermissionWaitController(
	handlers: ScreenPermissionWaitControllerHandlers,
	options?: ScreenPermissionWaitControllerOptions,
): ScreenPermissionWaitController {
	const now = options?.now ?? Date.now;
	// The post-grant cancel window only covers the gap between the grant
	// resolving and the renderer starting the countdown (milliseconds). The
	// expiry keeps a stale cancel from suppressing an unrelated future start.
	const POST_GRANT_CANCEL_WINDOW_MS = 2_000;

	type WaitState = "idle" | "pending" | "granted";
	let state: WaitState = "idle";
	let pendingResolve: ((result: ScreenPermissionWaitResult) => void) | null = null;
	let cancelAfterGrantAtMs: number | null = null;

	return {
		begin() {
			if (state === "pending") {
				return null;
			}
			cancelAfterGrantAtMs = null;
			const promise = new Promise<ScreenPermissionWaitResult>((resolve) => {
				pendingResolve = resolve;
			});
			state = "pending";
			handlers.onWaitStarted();
			return promise;
		},
		end(granted) {
			if (state !== "pending" || !pendingResolve) {
				return false;
			}
			const resolve = pendingResolve;
			pendingResolve = null;
			state = granted ? "granted" : "idle";
			resolve({ success: granted, cancelled: !granted });
			handlers.onWaitEnded(granted);
			return true;
		},
		cancel() {
			if (state === "pending" && pendingResolve) {
				const resolve = pendingResolve;
				pendingResolve = null;
				state = "idle";
				resolve({ success: false, cancelled: true });
				handlers.onWaitEnded(false);
				return true;
			}
			if (state === "granted") {
				// Overlay click after the grant: close the window and arm the
				// signal that blocks the imminent countdown start.
				state = "idle";
				cancelAfterGrantAtMs = now();
				handlers.onWaitEnded(false);
				return true;
			}
			return false;
		},
		isPending() {
			return state === "pending";
		},
		isAwaitingOverlay() {
			return state === "pending";
		},
		consumeCountdownStartGate() {
			const blocked =
				cancelAfterGrantAtMs !== null && now() - cancelAfterGrantAtMs <= POST_GRANT_CANCEL_WINDOW_MS;
			cancelAfterGrantAtMs = null;
			state = "idle";
			return blocked;
		},
	};
}
