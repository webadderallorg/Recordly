/** Keeps playback continuous, but coalesces paused edits into one animation frame.
 * Stopping the ticker retains the renderer, textures, and scene graph. */
export function createPreviewRenderLoop(options: {
	ticker: { started: boolean; start(): void; stop(): void };
	compose(): void;
	render(): void;
	requestFrame(callback: FrameRequestCallback): number;
	cancelFrame(id: number): void;
}) {
	let pendingFrame: number | null = null;
	let continuous = false;
	let suspended = false;
	let disposed = false;
	const cancelPending = () => {
		if (pendingFrame !== null) options.cancelFrame(pendingFrame);
		pendingFrame = null;
	};
	const requestRender = () => {
		if (disposed || suspended || continuous || pendingFrame !== null) return;
		pendingFrame = options.requestFrame(() => {
			pendingFrame = null;
			if (disposed || suspended || continuous) return;
			options.compose();
			options.render();
		});
	};
	return {
		requestRender,
		setState(playing: boolean, suspendRendering: boolean) {
			if (disposed) return;
			const changed =
				continuous !== (playing && !suspendRendering) || suspended !== suspendRendering;
			suspended = suspendRendering;
			continuous = playing && !suspended;
			if (continuous) {
				cancelPending();
				if (!options.ticker.started) options.ticker.start();
			} else {
				if (options.ticker.started) options.ticker.stop();
				if (suspended) cancelPending();
				else if (changed) requestRender();
			}
		},
		dispose() {
			disposed = true;
			cancelPending();
			if (options.ticker.started) options.ticker.stop();
		},
	};
}
