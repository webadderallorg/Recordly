import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { ipcMain } from "electron";
import { isTrustedRenderer } from "../../trustedRenderer";
import {
	normalizeCloudEndpoint,
	parseCloudRecordingCursor,
	parseCloudRecordingPage,
	parseCloudShareTicket,
} from "../cloudShareContract";
import { EARLY_PART_BYTES, uploadMultipart } from "../cloudShareMultipart";
import { isOwnedExportPath } from "../export/exportStream";
import { startGrowingShareUpload } from "../growingShareUpload";
import { isAllowedLocalReadPath } from "../project/manager";
import { createShareThumbnail } from "../recording/shareThumbnail";

const MAX_CONTROL_RESPONSE_BYTES = 1024 * 1024;
const MAX_AUTH_TOKEN_BYTES = 8192;
const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;
type ActiveUpload = {
	controller: AbortController;
	ownerId: number;
	token: string;
	finishing?: boolean;
	growing?: ReturnType<typeof startGrowingShareUpload>;
};
const activeUploads = new Map<string, ActiveUpload>();

/** Attach before any awaited file/network work, including finished-file uploads. */
function trackUploadLifetime(uploadId: string, upload: ActiveUpload, sender: Electron.WebContents) {
	const timeout = setTimeout(() => upload.controller.abort(), 30 * 60 * 1000);
	timeout.unref();
	const destroyed = () => upload.controller.abort();
	sender.once("destroyed", destroyed);
	upload.controller.signal.addEventListener(
		"abort",
		() => {
			clearTimeout(timeout);
			sender.removeListener("destroyed", destroyed);
			void (upload.growing?.cancel() ?? Promise.resolve())
				.finally(() => {
					if (activeUploads.get(uploadId) === upload) activeUploads.delete(uploadId);
				})
				.catch(() => undefined);
		},
		{ once: true },
	);
	if (sender.isDestroyed()) destroyed();
}

function validUploadToken(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		Buffer.byteLength(value) <= MAX_AUTH_TOKEN_BYTES &&
		!Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) > 126)
	);
}

function contentTypeFor(filePath: string) {
	switch (path.extname(filePath).toLowerCase()) {
		case ".mp4":
			return "video/mp4";
		case ".webm":
			return "video/webm";
		case ".mov":
			return "video/quicktime";
		case ".gif":
			return "image/gif";
		default:
			return "application/octet-stream";
	}
}

async function readJsonResponse(response: Response) {
	const text = await response.text();
	if (Buffer.byteLength(text) > MAX_CONTROL_RESPONSE_BYTES) {
		throw new Error("The cloud share server response was too large.");
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new Error(`The cloud share server returned invalid JSON (${response.status}).`);
	}
}

async function responseError(response: Response, fallback: string) {
	try {
		const body = await readJsonResponse(response);
		if (body && typeof body === "object" && "error" in body) {
			return String((body as { error: unknown }).error);
		}
	} catch {
		// Cloudflare may return an HTML/plain-text edge error instead of Worker JSON.
	}
	return `${fallback} (${response.status}).`;
}

export function registerCloudShareHandlers() {
	ipcMain.handle(
		"cloud-share-begin-export",
		(
			event,
			input: {
				endpoint?: unknown;
				token?: unknown;
				title?: unknown;
				uploadId?: unknown;
			},
		) => {
			try {
				if (!isTrustedRenderer(event))
					return { success: false, error: "Untrusted sharing request." };
				const endpoint = normalizeCloudEndpoint(input?.endpoint);
				if (
					!validUploadToken(input.token) ||
					typeof input.uploadId !== "string" ||
					!/^[a-f0-9-]{36}$/i.test(input.uploadId) ||
					activeUploads.has(input.uploadId) ||
					Array.from(activeUploads.values()).some(
						(upload) => upload.ownerId === event.sender.id,
					)
				)
					return { success: false };
				const uploadId = input.uploadId;
				const upload: ActiveUpload = {
					controller: new AbortController(),
					ownerId: event.sender.id,
					token: input.token,
				};
				upload.growing = startGrowingShareUpload({
					ownerId: event.sender.id,
					endpoint,
					title:
						typeof input.title === "string"
							? input.title.trim().slice(0, 200) || "Recording"
							: "Recording",
					getToken: () => upload.token,
					signal: upload.controller.signal,
					onProgress: (uploadedBytes, totalBytes) => {
						if (!event.sender.isDestroyed())
							event.sender.send("cloud-share-progress", {
								uploadId,
								uploadedBytes,
								totalBytes,
							});
					},
				});
				activeUploads.set(uploadId, upload);
				trackUploadLifetime(uploadId, upload, event.sender);
				return { success: true };
			} catch {
				return { success: false };
			}
		},
	);
	ipcMain.handle(
		"cloud-share-manage",
		async (
			event,
			input: {
				endpoint?: unknown;
				token?: unknown;
				action?: unknown;
				shareCode?: unknown;
				cursor?: unknown;
			},
		) => {
			try {
				if (!isTrustedRenderer(event))
					return { success: false, error: "Untrusted sharing request." };
				const endpoint = normalizeCloudEndpoint(input?.endpoint);
				if (
					typeof input.token !== "string" ||
					!input.token ||
					Buffer.byteLength(input.token) > MAX_AUTH_TOKEN_BYTES
				)
					throw new Error("Sign in to manage shared recordings.");
				if (input.action !== "list" && input.action !== "delete")
					throw new Error("Invalid recording action.");
				if (
					input.action === "delete" &&
					(typeof input.shareCode !== "string" ||
						!/^[a-z0-9]{1,128}$/.test(input.shareCode))
				)
					throw new Error("Invalid recording ID.");
				const url = new URL(
					input.action === "list" ? "/api/videos" : `/api/delete/${input.shareCode}`,
					endpoint,
				);
				if (input.action === "list") {
					url.searchParams.set("page", "1");
					const cursor = parseCloudRecordingCursor(input.cursor);
					if (cursor) url.searchParams.set("cursor", cursor);
				}
				const response = await fetch(url, {
					method: input.action === "list" ? "GET" : "DELETE",
					headers: { authorization: `Bearer ${input.token}` },
					redirect: "error",
					signal: AbortSignal.timeout(30000),
				});
				if (!response.ok)
					throw new Error(
						await responseError(response, "Could not manage shared recordings"),
					);
				if (input.action === "delete") return { success: true };
				return {
					success: true,
					...parseCloudRecordingPage(await readJsonResponse(response), endpoint),
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"cloud-share-upload",
		async (
			event,
			input: {
				filePath?: unknown;
				endpoint?: unknown;
				token?: unknown;
				title?: unknown;
				notes?: unknown;
				uploadId?: unknown;
			},
		) => {
			let uploadId: string | undefined;
			let activeUpload: ActiveUpload | undefined;
			let unpublishedReservation:
				| { origin: string; shareCode: string; getToken: () => string }
				| undefined;
			let finalizationAttempted = false;
			try {
				if (!isTrustedRenderer(event))
					return { success: false, error: "Untrusted sharing request." };
				const endpoint = normalizeCloudEndpoint(input?.endpoint);
				const token = typeof input.token === "string" ? input.token.trim() : "";
				if (!validUploadToken(token))
					throw new Error("Sign in to Recordly before creating a shared link.");
				uploadId =
					typeof input.uploadId === "string" && /^[a-f0-9-]{36}$/i.test(input.uploadId)
						? input.uploadId
						: crypto.randomUUID();
				const existing = activeUploads.get(uploadId);
				if (
					existing &&
					(!existing.growing ||
						existing.finishing ||
						existing.ownerId !== event.sender.id)
				)
					throw new Error("This upload is already in progress.");
				activeUpload = existing ?? {
					controller: new AbortController(),
					ownerId: event.sender.id,
					token,
				};
				activeUpload.finishing = true;
				const controller = activeUpload.controller;
				activeUploads.set(uploadId, activeUpload);
				if (!existing) trackUploadLifetime(uploadId, activeUpload, event.sender);
				const getToken = () => activeUpload!.token;
				if (typeof input?.filePath !== "string" || input.filePath.trim().length === 0) {
					throw new Error("Export a video before sharing it.");
				}
				const requestedPath = path.resolve(input.filePath);
				const resolvedPath = await fs.realpath(requestedPath);
				const isRecordlyExport =
					isOwnedExportPath(requestedPath) || isOwnedExportPath(resolvedPath);
				if (!isRecordlyExport && !isAllowedLocalReadPath(resolvedPath)) {
					throw new Error("This file is outside Recordly's approved media locations.");
				}
				const stat = await fs.stat(resolvedPath);
				if (!stat.isFile()) throw new Error("The exported video could not be found.");
				const title =
					(typeof input.title === "string" ? input.title.trim().slice(0, 200) : "") ||
					path.basename(resolvedPath, path.extname(resolvedPath));
				const notes =
					typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : "";

				// Decode the poster while video bytes upload, rather than after publication.
				// Handle rejection immediately even if the video upload fails first.
				const thumbnailPromise = createShareThumbnail(
					resolvedPath,
					controller.signal,
				).catch(() => undefined);
				const growingTicket = await activeUpload.growing?.finish(resolvedPath);
				controller.signal.throwIfAborted();
				const controlHeaders: Record<string, string> = {
					"content-type": "application/json",
				};
				controlHeaders.authorization = `Bearer ${getToken()}`;
				const ticketResponse = growingTicket
					? undefined
					: await fetch(endpoint, {
							method: "POST",
							headers: controlHeaders,
							body: JSON.stringify({
								name: path.basename(resolvedPath),
								title,
								fileSize: stat.size,
								notes,
								size: stat.size,
								contentType: contentTypeFor(resolvedPath),
							}),
							redirect: "error",
							signal: controller.signal,
						});
				const ticketBody = ticketResponse
					? await readJsonResponse(ticketResponse)
					: undefined;
				if (ticketResponse && !ticketResponse.ok) {
					const message =
						ticketBody && typeof ticketBody === "object" && "error" in ticketBody
							? String((ticketBody as { error: unknown }).error)
							: `Cloud share request failed (${ticketResponse.status}).`;
					throw new Error(message);
				}
				const ticket = growingTicket ?? parseCloudShareTicket(ticketBody);
				const endpointOrigin = new URL(endpoint).origin;
				if (new URL(ticket.shareUrl).origin !== endpointOrigin) {
					throw new Error("The share service returned an untrusted viewing URL.");
				}
				if (ticket.finalizeUrl && new URL(ticket.finalizeUrl).origin !== endpointOrigin) {
					throw new Error("The share service returned an untrusted finalization URL.");
				}
				if (
					!growingTicket &&
					ticket.shareCode &&
					ticket.finalizeUrl &&
					new URL(ticket.uploadUrl).origin === endpointOrigin
				) {
					unpublishedReservation = {
						origin: endpointOrigin,
						shareCode: ticket.shareCode,
						getToken,
					};
				}
				const contentType = contentTypeFor(resolvedPath);
				const sendProgress = (uploadedBytes: number) => {
					if (event.sender.isDestroyed()) return;
					event.sender.send("cloud-share-progress", {
						uploadId,
						uploadedBytes,
						totalBytes: stat.size,
					});
				};
				const parallelUploads =
					ticketBody &&
					typeof ticketBody === "object" &&
					"parallelUploads" in ticketBody &&
					ticketBody.parallelUploads === true;
				const canUseMultipart =
					stat.size > (parallelUploads ? EARLY_PART_BYTES : MULTIPART_THRESHOLD_BYTES) &&
					ticket.shareCode !== undefined &&
					new URL(ticket.uploadUrl).origin === endpointOrigin;

				if (growingTicket) {
					sendProgress(stat.size);
				} else if (canUseMultipart) {
					await uploadMultipart({
						endpoint,
						shareCode: ticket.shareCode as string,
						filePath: resolvedPath,
						fileSize: stat.size,
						contentType,
						// Older hosted services serialize part requests. Keep them usable
						// until the matching service upgrade is deployed.
						concurrency: parallelUploads ? 3 : 1,
						getToken,
						signal: controller.signal,
						onProgress: sendProgress,
					});
				} else {
					let uploaded = 0;
					const progress = new Transform({
						transform(chunk, _encoding, callback) {
							uploaded += chunk.length;
							sendProgress(uploaded);
							callback(null, chunk);
						},
					});
					const source = createReadStream(resolvedPath);
					const body = source.pipe(progress);
					source.on("error", (error) => body.destroy(error));
					const uploadHeaders: Record<string, string> = {
						"content-type": contentType,
						"content-length": String(stat.size),
						...ticket.headers,
					};
					if (new URL(ticket.uploadUrl).origin === endpointOrigin) {
						uploadHeaders.authorization = `Bearer ${getToken()}`;
					}
					try {
						const uploadResponse = await fetch(ticket.uploadUrl, {
							method: "PUT",
							headers: uploadHeaders,
							body: body as unknown as BodyInit,
							duplex: "half",
							redirect: "error",
							signal: controller.signal,
						} as RequestInit & { duplex: "half" });
						if (!uploadResponse.ok) {
							throw new Error(
								await responseError(uploadResponse, "Video upload failed"),
							);
						}
					} finally {
						body.destroy();
						source.destroy();
					}
				}

				if (ticket.finalizeUrl) {
					const finalizeHeaders: Record<string, string> = {
						"content-type": "application/json",
					};
					if (token && new URL(ticket.finalizeUrl).origin === new URL(endpoint).origin) {
						finalizeHeaders.authorization = `Bearer ${getToken()}`;
					}
					// A lost response may still have published the recording. From this
					// point onward, preserve it for the owner rather than deleting it.
					finalizationAttempted = true;
					const finalizeResponse = await fetch(ticket.finalizeUrl, {
						method: "POST",
						headers: finalizeHeaders,
						body: JSON.stringify({
							title,
							summary: notes,
						}),
						redirect: "error",
						signal: controller.signal,
					});
					if (!finalizeResponse.ok) {
						throw new Error(
							`Cloud share finalization failed (${finalizeResponse.status}).`,
						);
					}
				}
				if (ticket.shareCode) {
					try {
						const thumbnail = await thumbnailPromise;
						if (!thumbnail) throw new Error("Video poster unavailable");
						const response = await fetch(
							new URL(`/api/upload-thumbnail/${ticket.shareCode}`, endpointOrigin),
							{
								method: "PUT",
								headers: {
									authorization: `Bearer ${getToken()}`,
									"content-type": "image/jpeg",
									"content-length": String(thumbnail.length),
								},
								body: new Uint8Array(thumbnail),
								redirect: "error",
								signal: AbortSignal.any([
									controller.signal,
									AbortSignal.timeout(10_000),
								]),
							},
						);
						if (!response.ok)
							throw new Error(`Thumbnail upload failed (${response.status})`);
					} catch {
						// The recording is already published. Older/missing posters use the
						// video's first frame in the library instead of failing the share.
						console.warn(
							"Shared video poster unavailable; using video preview fallback.",
						);
					}
				}

				return { success: true, uploadId, shareUrl: ticket.shareUrl };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					success: false,
					uploadId,
					canceled: message.includes("aborted"),
					error: message,
				};
			} finally {
				activeUpload?.controller.abort();
				if (unpublishedReservation && !finalizationAttempted) {
					try {
						await fetch(
							new URL(
								`/api/delete/${unpublishedReservation.shareCode}`,
								unpublishedReservation.origin,
							),
							{
								method: "DELETE",
								headers: {
									authorization: `Bearer ${unpublishedReservation.getToken()}`,
								},
								redirect: "error",
								// Cleanup must remain possible after cancellation of the upload.
								signal: AbortSignal.timeout(10_000),
							},
						);
					} catch {
						// Keep the original failure. Shared and abandoned-upload expiry
						// remain available if best-effort reservation cleanup fails.
					}
				}
				if (uploadId && activeUpload && activeUploads.get(uploadId) === activeUpload)
					activeUploads.delete(uploadId);
			}
		},
	);

	ipcMain.handle("cloud-share-update-token", (event, input: unknown) => {
		if (!isTrustedRenderer(event)) return { success: false };
		if (!input || typeof input !== "object" || Array.isArray(input)) return { success: false };
		const request = input as { uploadId?: unknown; token?: unknown };
		if (typeof request.uploadId !== "string" || !validUploadToken(request.token))
			return { success: false };
		const upload = activeUploads.get(request.uploadId);
		if (!upload || upload.ownerId !== event.sender.id || upload.controller.signal.aborted)
			return { success: false };
		upload.token = request.token;
		return { success: true };
	});

	ipcMain.handle("cloud-share-cancel", (event, uploadId: unknown) => {
		if (!isTrustedRenderer(event)) return { success: false };
		if (typeof uploadId !== "string") return { success: false };
		const upload = activeUploads.get(uploadId);
		if (!upload || upload.ownerId !== event.sender.id) return { success: false };
		upload.controller.abort();
		return { success: true };
	});
}
