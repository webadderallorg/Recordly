// Polyfill for WebGL context detection on environments (e.g. Windows ARM64 / Qualcomm Adreno)
// where WebGL2 is available but legacy WebGL1 context ("webgl") returns null.
if (typeof HTMLCanvasElement !== "undefined") {
	const originalGetContext = HTMLCanvasElement.prototype.getContext;
	(HTMLCanvasElement.prototype as any).getContext = function (
		this: HTMLCanvasElement,
		contextId: string,
		...args: any[]
	) {
		let context = (originalGetContext as any).apply(this, [contextId, ...args]);
		if (!context && contextId === "webgl") {
			context = (originalGetContext as any).apply(this, ["webgl2", ...args]);
		}
		return context;
	};
}
