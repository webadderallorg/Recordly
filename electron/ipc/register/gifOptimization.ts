import { ipcMain } from "electron";
import { compressGifBuffer, MAX_GIF_OPTIMIZATION_BYTES } from "../export/gifOptimization";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";

const MAX_CONCURRENT_OPTIMIZATIONS = 2;
const validRequestId = (value: unknown): value is string =>
	typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function registerGifOptimizationHandlers() {
	// Reserve the owner synchronously, before any file I/O, so cancellation and
	// renderer destruction also cover the period before FFmpeg has been spawned.
	const active = new Map<number, { requestId: string; controller: AbortController }>();
	ipcMain.handle("optimize-gif", async (event, requestId: unknown, data: unknown) => {
		if (
			!validRequestId(requestId) ||
			!(data instanceof ArrayBuffer) ||
			data.byteLength < 14 ||
			data.byteLength > MAX_GIF_OPTIMIZATION_BYTES
		) {
			return { success: false, error: "Invalid GIF optimization request" };
		}
		const owner = event.sender;
		if (owner.isDestroyed()) return { success: false, error: "GIF optimization canceled" };
		if (active.has(owner.id) || active.size >= MAX_CONCURRENT_OPTIMIZATIONS) {
			return {
				success: false,
				error: "GIF optimization is already running; retry when it finishes",
			};
		}
		const controller = new AbortController();
		const abandon = () => controller.abort(new Error("GIF optimization canceled"));
		active.set(owner.id, { requestId, controller });
		owner.once("destroyed", abandon);
		try {
			const output = await compressGifBuffer(new Uint8Array(data), {
				ffmpegPath: getFfmpegBinaryPath(),
				signal: controller.signal,
			});
			if (controller.signal.aborted || owner.isDestroyed()) {
				return { success: false, error: "GIF optimization canceled" };
			}
			return { success: true, data: output };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "GIF optimization failed",
			};
		} finally {
			owner.removeListener("destroyed", abandon);
			active.delete(owner.id);
		}
	});
	ipcMain.handle("cancel-gif-optimization", (event, requestId: unknown) => {
		if (!validRequestId(requestId))
			return { success: false, error: "Invalid GIF optimization request" };
		const job = active.get(event.sender.id);
		if (job?.requestId === requestId) {
			job.controller.abort(new Error("GIF optimization canceled"));
		}
		return { success: true };
	});
}
