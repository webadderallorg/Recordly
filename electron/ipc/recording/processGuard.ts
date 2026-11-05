import type { ChildProcess } from "node:child_process";

/** One reservation covers async startup and the capture child's entire lifetime. */
export class RecordingProcessGuard {
	private starting = false;
	private child: ChildProcess | null = null;
	private releaseLease: (() => void) | null = null;
	constructor(private acquireLease?: (args: unknown[]) => (() => void) | null) {}
	private releaseIfIdle() {
		if (!this.starting && !this.child) {
			this.releaseLease?.();
			this.releaseLease = null;
		}
	}

	wrap<Args extends unknown[], Result>(start: (...args: Args) => Promise<Result>) {
		return async (...args: Args) => {
			if (this.starting || this.child) {
				return {
					success: false as const,
					message: "A recording is already starting or active.",
				};
			}
			// Reserve synchronously, before permissions, filesystem access, or any other await.
			if (this.acquireLease) {
				this.releaseLease = this.acquireLease(args);
				if (!this.releaseLease)
					return {
						success: false as const,
						message: "A recording is already starting or active in this Recordly instance.",
					};
			}
			this.starting = true;
			try {
				return await start(...args);
			} finally {
				this.starting = false;
				this.releaseIfIdle();
			}
		};
	}

	track<T extends ChildProcess>(child: T): T {
		this.child = child;
		// kill() only requests termination. Keep ownership until close, including
		// failed starts whose legacy state has already been cleared by cleanup.
		child.once("close", () => {
			if (this.child === child) this.child = null;
			this.releaseIfIdle();
		});
		return child;
	}
}
