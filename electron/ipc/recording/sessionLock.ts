import type { WebContents } from "electron";

type Owner = Pick<WebContents, "id" | "on" | "removeListener">;
type Release = () => void;

/** One recording per main process; separate app instances record independently. */
export class RecordingSessionLock {
	private ownerId: number | null = null;
	private holds = 0;
	private renderer: {
		owner: Owner;
		token: string;
		release: Release;
		active: boolean;
		unwatch: Release;
	} | null = null;
	constructor(private onOwnerLost: () => void) {}
	acquire(ownerId: number): Release | null {
		if (this.ownerId !== null && this.ownerId !== ownerId) return null;
		this.ownerId = ownerId;
		this.holds++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (--this.holds === 0) {
				this.ownerId = null;
			}
		};
	}
	reserve(owner: Owner, token = ""): boolean {
		if (this.renderer) return false;
		const release = this.acquire(owner.id);
		if (!release) return false;
		const gone = () => {
			this.clearRenderer();
			// Native capture owns another hold and performs its own save/recovery.
			if (this.holds === 0) this.onOwnerLost();
		};
		owner.on("destroyed", gone);
		owner.on("render-process-gone", gone);
		owner.on("did-navigate", gone);
		this.renderer = {
			owner,
			token,
			release,
			active: false,
			unwatch: () => {
				owner.removeListener("destroyed", gone);
				owner.removeListener("render-process-gone", gone);
				owner.removeListener("did-navigate", gone);
			},
		};
		return true;
	}
	setRecording(ownerId: number | undefined, active: boolean) {
		if (ownerId === undefined && !active) {
			this.clearRenderer();
			return;
		}
		if (!this.renderer || this.renderer.owner.id !== ownerId) return;
		this.renderer.active = active;
		if (!active) this.clearRenderer();
	}
	finishStartup(ownerId: number, token = "") {
		if (
			this.renderer?.owner.id === ownerId &&
			this.renderer.token === token &&
			!this.renderer.active
		)
			this.clearRenderer();
	}
	private clearRenderer() {
		const renderer = this.renderer;
		this.renderer = null;
		renderer?.unwatch();
		renderer?.release();
	}
}
