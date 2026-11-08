import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseCloudShareTicket } from "./cloudShareContract";
import { type MultipartUploadSource, uploadMultipart } from "./cloudShareMultipart";

const MAX_RESERVATION_BYTES = 100_000_000_000;
type Ticket = ReturnType<typeof parseCloudShareTicket>;

// Only main-process export handlers supply these paths; renderer input is never
// used to discover an unfinished export on disk.
const exportObservers = new Map<number, (filePath: string) => void>();
const observedPaths = new Map<number, string>();

export function progressiveShareFfmpegArgs(args: string[]): string[] {
	if (!Array.from(observedPaths.values()).includes(args[args.length - 1])) return args;
	// Range playback supports moov-at-end. Avoid moving every encoded byte to
	// insert moov at the front after it has already started uploading.
	return args.filter(
		(arg, index) =>
			!(
				(arg === "-movflags" && args[index + 1] === "+faststart") ||
				(arg === "+faststart" && args[index - 1] === "-movflags")
			),
	);
}
export function replaceShareExportSource(previousPath: string, nextPath: string) {
	for (const [ownerId, filePath] of observedPaths) {
		if (filePath === previousPath) exportObservers.get(ownerId)?.(nextPath);
	}
}
export function observeShareExportSource(ownerId: number, filePath: string) {
	exportObservers.get(ownerId)?.(filePath);
}

export function startGrowingShareUpload(options: {
	ownerId: number;
	endpoint: string;
	title: string;
	getToken: () => string;
	signal: AbortSignal;
	onProgress: (uploadedBytes: number, totalBytes: number) => void;
}) {
	const uploadController = new AbortController();
	const uploadSignal = AbortSignal.any([options.signal, uploadController.signal]);
	let reservationBytes = MAX_RESERVATION_BYTES;
	let growingPath: string | undefined;
	let finalPath: string | undefined;
	let finalSize: number | undefined;
	let finalizationError: unknown;
	let uploadedBytes = 0;
	let ticket: Ticket | undefined;
	const origin = new URL(options.endpoint).origin;
	const auth = () => ({ authorization: `Bearer ${options.getToken()}` });
	const observe = (filePath: string) => {
		growingPath = filePath;
		observedPaths.set(options.ownerId, filePath);
	};
	if (exportObservers.has(options.ownerId)) throw new Error("A share export is already active.");
	exportObservers.set(options.ownerId, observe);
	const stopObserving = () => {
		if (exportObservers.get(options.ownerId) === observe) {
			exportObservers.delete(options.ownerId);
			observedPaths.delete(options.ownerId);
		}
	};
	const wait = () => delay(250, undefined, { signal: uploadSignal });
	const source: MultipartUploadSource = {
		async getPart(index, signal, partBytes) {
			for (;;) {
				signal.throwIfAborted();
				if (finalizationError) throw finalizationError;
				const candidate = finalPath ?? growingPath;
				if (candidate) {
					const stat = await fs.stat(candidate).catch((error) => {
						// Only an unfinished export may still be creating/replacing its file.
						if (candidate === finalPath) throw error;
						return undefined;
					});
					const offset = index * partBytes;
					if (stat && (finalPath || stat.size >= offset + partBytes)) {
						if (stat.size > reservationBytes)
							throw new Error("Export exceeded upload reservation");
						if (offset >= stat.size) return null;
						return {
							filePath: candidate,
							size: Math.min(partBytes, stat.size - offset),
						};
					}
				}
				await wait();
			}
		},
		async finalize(signal) {
			while (!finalPath) {
				signal.throwIfAborted();
				if (finalizationError) throw finalizationError;
				await wait();
			}
			const stat = await fs.stat(finalPath);
			if (stat.size <= 0 || stat.size > reservationBytes)
				throw new Error("Export exceeded upload reservation");
			return { fileSize: stat.size, filePath: finalPath };
		},
	};
	const cleanup = async () => {
		if (!ticket?.shareCode) return;
		try {
			await fetch(new URL(`/api/delete/${ticket.shareCode}`, origin), {
				method: "DELETE",
				headers: auth(),
				redirect: "error",
				signal: AbortSignal.timeout(5000),
			});
		} catch {
			/* Best effort; incomplete recordings remain removable from Shared. */
		}
	};
	const task = (async (): Promise<Ticket | undefined> => {
		try {
			const response = await fetch(options.endpoint, {
				method: "POST",
				headers: { ...auth(), "content-type": "application/json" },
				body: JSON.stringify({
					title: options.title,
					fileSize: reservationBytes,
					progressive: true,
					contentType: "video/mp4",
				}),
				redirect: "error",
				signal: uploadSignal,
			});
			if (!response.ok) return undefined;
			const responseText = await response.text();
			if (Buffer.byteLength(responseText) > 1024 * 1024)
				throw new Error("Upload ticket is too large");
			const body = JSON.parse(responseText);
			ticket = parseCloudShareTicket(body);
			if (
				new URL(ticket.shareUrl).origin !== origin ||
				new URL(ticket.uploadUrl).origin !== origin ||
				!ticket.shareCode ||
				(ticket.finalizeUrl && new URL(ticket.finalizeUrl).origin !== origin)
			) {
				// Never send credentials or cleanup requests to a ticket-supplied origin.
				throw new Error("Untrusted progressive upload ticket");
			}
			if (body.progressiveUpload !== true) {
				await cleanup();
				return undefined;
			}
			if (
				!Number.isSafeInteger(body.reservationBytes) ||
				body.reservationBytes <= 0 ||
				body.reservationBytes > MAX_RESERVATION_BYTES
			)
				throw new Error("Invalid upload reservation");
			reservationBytes = body.reservationBytes;
			await uploadMultipart({
				endpoint: options.endpoint,
				shareCode: ticket.shareCode,
				filePath: "",
				fileSize: reservationBytes,
				contentType: "video/mp4",
				getToken: options.getToken,
				signal: uploadSignal,
				source,
				onProgress: (bytes) => {
					uploadedBytes = bytes;
					if (finalSize !== undefined)
						options.onProgress(Math.min(bytes, finalSize), finalSize);
				},
			});
			return ticket;
		} catch {
			await cleanup();
			return undefined;
		} finally {
			stopObserving();
		}
	})();
	return {
		async finish(filePath: string) {
			// The reservation is an upper bound, not the number of bytes to upload.
			// Rebase bytes already sent while exporting as soon as the final size is known.
			try {
				const stat = await fs.stat(filePath);
				finalSize = stat.size;
				finalPath = filePath;
			} catch (error) {
				// Wake the polling source through its normal failure/cleanup path.
				finalizationError = error;
			}
			if (finalSize !== undefined && finalSize > 0)
				options.onProgress(Math.min(uploadedBytes, finalSize), finalSize);
			return task;
		},
		async cancel() {
			uploadController.abort();
			stopObserving();
			await task;
		},
	};
}
