import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Transform } from "node:stream";

const MAX_CONTROL_RESPONSE_BYTES = 1024 * 1024;
export const MULTIPART_PART_BYTES = 25 * 1024 * 1024;
export const EARLY_PART_BYTES = 5 * 1024 * 1024;
const MULTIPART_PART_ATTEMPTS = 3;
const MULTIPART_CONCURRENCY = 3;
type UploadedPart = { partNumber: number; etag: string };
class NonRetryableUploadError extends Error {}

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

function waitForRetry(delayMs: number, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new Error("Upload aborted"));
			return;
		}
		const handleAbort = () => {
			clearTimeout(timeout);
			reject(signal.reason ?? new Error("Upload aborted"));
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", handleAbort);
			resolve();
		}, delayMs);
		signal.addEventListener("abort", handleAbort, { once: true });
	});
}

function isRetryableUploadStatus(status: number) {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

export type MultipartUploadSource = {
	/** Wait for an available full part, the finalized tail, or final EOF. */
	getPart: (
		partIndex: number,
		signal: AbortSignal,
		partBytes: number,
	) => Promise<{ filePath: string; size: number } | null>;
	/** Wait for export finalization, including header patches or final remuxing. */
	finalize: (signal: AbortSignal) => Promise<{ fileSize: number; filePath: string }>;
};

export async function uploadMultipart(options: {
	endpoint: string;
	shareCode: string;
	filePath: string;
	fileSize: number;
	source?: MultipartUploadSource;
	concurrency?: number;
	contentType: string;
	getToken: () => string;
	signal: AbortSignal;
	onProgress: (uploadedBytes: number) => void;
}) {
	const endpointOrigin = new URL(options.endpoint).origin;
	const authHeaders = () => ({ authorization: `Bearer ${options.getToken()}` });
	const startResponse = await fetch(
		new URL(`/api/upload-multipart/${options.shareCode}`, endpointOrigin),
		{
			method: "POST",
			headers: { ...authHeaders(), "x-recordly-part-bytes": String(EARLY_PART_BYTES) },
			redirect: "error",
			signal: options.signal,
		},
	);
	if (!startResponse.ok) {
		throw new Error(await responseError(startResponse, "Could not start video upload"));
	}
	const startBody = await readJsonResponse(startResponse);
	const multipartUploadId =
		startBody &&
		typeof startBody === "object" &&
		"uploadId" in startBody &&
		typeof (startBody as { uploadId: unknown }).uploadId === "string"
			? (startBody as { uploadId: string }).uploadId
			: "";
	if (!multipartUploadId || Buffer.byteLength(multipartUploadId) > 2048) {
		throw new Error("The cloud share server returned an invalid multipart upload ID.");
	}

	// Older servers omit this field and retain their 25 MiB protocol.
	const partBytes =
		startBody && typeof startBody === "object" && "partBytes" in startBody
			? startBody.partBytes
			: MULTIPART_PART_BYTES;
	if (partBytes !== EARLY_PART_BYTES && partBytes !== MULTIPART_PART_BYTES)
		throw new Error("The cloud share server returned an invalid part size.");

	const encodedUploadId = encodeURIComponent(multipartUploadId);
	const parts: UploadedPart[] = [];
	const uploadedDigests = new Map<number, string>();
	let finalizedFile: { fileSize: number; filePath: string } | undefined;
	// Each part owns a high-water mark, so a retry cannot count the same bytes twice
	// or move the UI backwards while other workers continue making progress.
	const partUploadedBytes = new Map<number, number>();
	let reportedBytes = 0;
	const reportProgress = (partNumber: number, bytes: number) => {
		partUploadedBytes.set(partNumber, Math.max(partUploadedBytes.get(partNumber) ?? 0, bytes));
		const total = Math.min(
			options.fileSize,
			Array.from(partUploadedBytes.values()).reduce((a, b) => a + b, 0),
		);
		if (total > reportedBytes) {
			reportedBytes = total;
			options.onProgress(total);
		}
	};
	const controller = new AbortController();
	const signal = controller.signal;
	const handleAbort = () => controller.abort(options.signal.reason);
	options.signal.addEventListener("abort", handleAbort, { once: true });
	if (options.signal.aborted) handleAbort();
	let completed = false;

	try {
		const partCount = Math.ceil(options.fileSize / partBytes);
		let sourceEnded = false;
		let nextPartIndex = 0;
		const uploadPart = async (partIndex: number) => {
			const partNumber = partIndex + 1;
			const start = partIndex * partBytes;
			const part = finalizedFile
				? {
						filePath: finalizedFile.filePath,
						size: Math.min(finalizedFile.fileSize - start, partBytes),
					}
				: options.source
					? await options.source.getPart(partIndex, signal, partBytes)
					: {
							filePath: options.filePath,
							size: Math.min(options.fileSize - start, partBytes),
						};
			if (!part) {
				sourceEnded = true;
				return;
			}
			const partSize = part.size;
			if (
				!Number.isSafeInteger(partSize) ||
				partSize <= 0 ||
				partSize > partBytes ||
				start + partSize > options.fileSize
			) {
				throw new Error(`Invalid size for video part ${partNumber}.`);
			}
			const end = start + partSize - 1;
			let uploadedPart: UploadedPart | undefined;

			for (let attempt = 1; attempt <= MULTIPART_PART_ATTEMPTS; attempt += 1) {
				const partToken = options.getToken();
				let attemptBytes = 0;
				const hash = createHash("sha256");
				const progress = new Transform({
					transform(chunk, _encoding, callback) {
						attemptBytes += chunk.length;
						hash.update(chunk);
						reportProgress(partNumber, attemptBytes);
						callback(null, chunk);
					},
				});
				const source = createReadStream(part.filePath, { start, end });
				const body = source.pipe(progress);
				source.on("error", (error) => body.destroy(error));
				try {
					const partResponse = await fetch(
						new URL(
							`/api/upload-part/${options.shareCode}/${encodedUploadId}/${partNumber}`,
							endpointOrigin,
						),
						{
							method: "PUT",
							headers: {
								authorization: `Bearer ${partToken}`,
								"content-type": options.contentType,
								"content-length": String(partSize),
								"x-recordly-part-bytes": String(partBytes),
							},
							body: body as unknown as BodyInit,
							duplex: "half",
							redirect: "error",
							signal,
						} as RequestInit & { duplex: "half" },
					);
					if (!partResponse.ok) {
						const message = await responseError(
							partResponse,
							`Video part ${partNumber} failed`,
						);
						if (
							!isRetryableUploadStatus(partResponse.status) &&
							!(partResponse.status === 401 && partToken !== options.getToken())
						) {
							throw new NonRetryableUploadError(message);
						}
						throw new Error(message);
					} else {
						const partBody = await readJsonResponse(partResponse);
						const etag =
							partBody && typeof partBody === "object" && "etag" in partBody
								? (partBody as { etag: unknown }).etag
								: undefined;
						const returnedPartNumber =
							partBody && typeof partBody === "object" && "partNumber" in partBody
								? (partBody as { partNumber: unknown }).partNumber
								: undefined;
						if (typeof etag !== "string" || returnedPartNumber !== partNumber) {
							throw new NonRetryableUploadError(
								`The cloud share server returned invalid data for video part ${partNumber}.`,
							);
						}
						if (attemptBytes !== partSize) {
							throw new NonRetryableUploadError(
								`Video part ${partNumber} ended before its declared size.`,
							);
						}
						uploadedDigests.set(partNumber, hash.digest("hex"));
						uploadedPart = { partNumber, etag };
						break;
					}
				} catch (error) {
					if (
						signal.aborted ||
						error instanceof NonRetryableUploadError ||
						attempt === MULTIPART_PART_ATTEMPTS
					) {
						throw error;
					}
				} finally {
					body.destroy();
					source.destroy();
				}

				await waitForRetry(300 * 3 ** (attempt - 1), signal);
			}

			if (!uploadedPart) throw new Error(`Video part ${partNumber} could not be uploaded.`);
			const existingIndex = parts.findIndex((part) => part.partNumber === partNumber);
			if (existingIndex >= 0) parts[existingIndex] = uploadedPart;
			else parts.push(uploadedPart);
			reportProgress(partNumber, partSize);
		};
		let partIndices = Array.from({ length: partCount }, (_, index) => index);
		let workerError: unknown;
		const worker = async () => {
			try {
				while (!signal.aborted && !sourceEnded && nextPartIndex < partIndices.length) {
					const partIndex = partIndices[nextPartIndex++];
					await uploadPart(partIndex);
				}
			} catch (error) {
				if (!signal.aborted) {
					workerError = error;
					controller.abort(error);
				}
				throw error;
			}
		};
		const runWorkers = async () => {
			// Settle every request before remotely aborting: late PUTs must not race cleanup.
			const workers = await Promise.allSettled(
				Array.from(
					{
						length: Math.min(
							options.concurrency === 1 ? 1 : MULTIPART_CONCURRENCY,
							partIndices.length,
						),
					},
					() => worker(),
				),
			);
			if (signal.aborted) throw workerError ?? signal.reason ?? new Error("Upload aborted");
			const failure = workers.find((result) => result.status === "rejected");
			if (failure?.status === "rejected") throw failure.reason;
		};
		await runWorkers();
		let finalSize: number | undefined;
		if (options.source) {
			const final = await options.source.finalize(signal);
			finalSize = final.fileSize;
			if (
				!Number.isSafeInteger(finalSize) ||
				finalSize <= 0 ||
				finalSize > options.fileSize
			) {
				throw new Error("The exported video exceeds the reserved upload size.");
			}
			finalizedFile = final;
			const finalPartCount = Math.ceil(finalSize / partBytes);
			partIndices = [];
			// MP4 finalization and audio remuxes can patch or replace earlier bytes.
			// Compare actual uploaded content against the final artifact, never assuming
			// only its first part changed. Reads are bounded to a single streamed part.
			for (let index = 0; index < finalPartCount; index += 1) {
				signal.throwIfAborted();
				const hash = createHash("sha256");
				const start = index * partBytes;
				const end = Math.min(finalSize, start + partBytes) - 1;
				const stream = createReadStream(final.filePath, { start, end, signal });
				let bytes = 0;
				for await (const chunk of stream) {
					hash.update(chunk);
					bytes += chunk.length;
				}
				if (bytes !== end - start + 1)
					throw new Error("The finalized video ended unexpectedly.");
				if (uploadedDigests.get(index + 1) !== hash.digest("hex")) partIndices.push(index);
			}
			for (let index = parts.length - 1; index >= 0; index -= 1) {
				if (parts[index].partNumber > finalPartCount) parts.splice(index, 1);
			}

			nextPartIndex = 0;
			sourceEnded = false;
			await runWorkers();
			if (
				parts.length !== finalPartCount ||
				parts.some((part) => part.partNumber > finalPartCount)
			) {
				throw new Error("The exported video is missing uploaded parts.");
			}
		}

		parts.sort((a, b) => a.partNumber - b.partNumber);

		const completeResponse = await fetch(
			new URL(`/api/upload-complete/${options.shareCode}/${encodedUploadId}`, endpointOrigin),
			{
				method: "POST",
				headers: {
					...authHeaders(),
					"content-type": "application/json",
					"x-recordly-part-bytes": String(partBytes),
				},
				body: JSON.stringify({ parts, ...(finalSize === undefined ? {} : { finalSize }) }),
				redirect: "error",
				signal,
			},
		);
		if (!completeResponse.ok) {
			throw new Error(await responseError(completeResponse, "Could not finish video upload"));
		}
		completed = true;
	} finally {
		options.signal.removeEventListener("abort", handleAbort);
		if (!completed) {
			try {
				await fetch(
					new URL(
						`/api/upload-abort/${options.shareCode}/${encodedUploadId}`,
						endpointOrigin,
					),
					{
						method: "POST",
						headers: authHeaders(),
						redirect: "error",
						signal: AbortSignal.timeout(5000),
					},
				);
			} catch {
				// R2 also reaps abandoned multipart uploads, so cleanup is best-effort.
			}
		}
	}
}
