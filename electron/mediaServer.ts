import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { approvedLocalReadPaths, foldPathComparisonKey } from "./ipc/state";
import { getMediaContentType } from "./mediaTypes";

let mediaServerBaseUrl: string | null = null;
let mediaServerStartPromise: Promise<string> | null = null;

// A pending URL is minted for a supported in-root sidecar candidate before the
// Windows mux rename completes, so the media server may receive a request for a
// file that does not exist yet. When the lexical path was granted a pending URL
// (inside an allowed root AND present in the approved set), wait a short bounded
// time for the file to appear before falling back to a rejection. The wait only
// applies to already-approved in-root paths; after the file appears the standard
// realpath + containment authorization still runs, so symlink escapes and
// outside roots are rejected exactly as before.
export const PENDING_MEDIA_APPEAR_POLL_INTERVAL_MS = 100;

export const PENDING_MEDIA_APPEAR_TIMEOUT_MS = 3000;

let pendingMediaAppearTimeoutMs = PENDING_MEDIA_APPEAR_TIMEOUT_MS;

// Test-only override so regression tests do not stall for the full window.
export function setPendingMediaAppearTimeoutMsForTests(timeoutMs: number) {
	pendingMediaAppearTimeoutMs = timeoutMs;
}

export function resolveHttpByteRange(
	rangeHeader: string,
	fileSize: number,
): { start: number; end: number } | null {
	const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
	if (!match || (!match[1] && !match[2])) {
		return null;
	}

	if (fileSize === 0) {
		return null;
	}

	if (!match[1] && match[2]) {
		// Suffix range: bytes=-500
		const suffixLength = Number.parseInt(match[2], 10);
		if (Number.isNaN(suffixLength) || suffixLength <= 0) {
			return null;
		}

		return {
			start: Math.max(0, fileSize - suffixLength),
			end: fileSize - 1,
		};
	}

	const start = Number.parseInt(match[1], 10);
	if (Number.isNaN(start) || start < 0 || start >= fileSize) {
		return null;
	}

	const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
	if (Number.isNaN(requestedEnd) || requestedEnd < start) {
		return null;
	}

	return {
		start,
		end: Math.min(requestedEnd, fileSize - 1),
	};
}

async function resolveRealPath(filePath: string): Promise<string | null> {
	try {
		return await fs.realpath(path.resolve(filePath));
	} catch {
		return null;
	}
}

async function isPendingApprovedMediaPath(lexicalPath: string): Promise<boolean> {
	const { getAllowedLocalReadRootsSync, isPathInsideDirectory } = await import(
		"./ipc/project/manager"
	);
	const rootContained = getAllowedLocalReadRootsSync().some((root) =>
		isPathInsideDirectory(lexicalPath, root),
	);
	return rootContained && approvedLocalReadPaths.has(foldPathComparisonKey(lexicalPath));
}

async function waitForPendingMediaFile(lexicalPath: string): Promise<string | null> {
	const deadline = Date.now() + pendingMediaAppearTimeoutMs;
	while (Date.now() < deadline) {
		const resolvedPath = await resolveRealPath(lexicalPath);
		if (resolvedPath) {
			return resolvedPath;
		}
		await new Promise((resolve) => setTimeout(resolve, PENDING_MEDIA_APPEAR_POLL_INTERVAL_MS));
	}
	return null;
}

export async function isAllowedMediaPath(realPath: string): Promise<boolean> {
	const resolvedRealPath = path.resolve(realPath);
	// Accept any real file contained inside an allowed root (this covers pending
	// sidecar URLs granted for a lexical in-root path that only appeared after
	// the mux rename) OR an explicitly approved path. realpath has already been
	// resolved by the caller, so a symlink/reparse-point escape from inside a
	// root lands outside the roots here and is rejected. The manager module is
	// imported lazily so importing this module does not pull the app-paths chain
	// (pure helpers like resolveHttpByteRange stay importable in tests without an
	// Electron mock).
	const { getAllowedLocalReadRootsSync, isPathInsideDirectory } = await import(
		"./ipc/project/manager"
	);
	const rootContained = getAllowedLocalReadRootsSync().some((root) =>
		isPathInsideDirectory(resolvedRealPath, root),
	);
	return rootContained || approvedLocalReadPaths.has(foldPathComparisonKey(resolvedRealPath));
}

async function handleMediaRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	try {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");

		if (url.pathname !== "/video") {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not Found");
			return;
		}

		const rawPath = url.searchParams.get("path");
		if (!rawPath) {
			response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Missing path parameter");
			return;
		}

		const lexicalPath = path.resolve(rawPath);
		let resolvedPath = await resolveRealPath(lexicalPath);
		let pendingApproved = false;
		if (!resolvedPath) {
			pendingApproved = await isPendingApprovedMediaPath(lexicalPath);
			if (pendingApproved) {
				// The file was still inside the mux rename window when the request
				// arrived. Wait briefly for it to appear; the authorization below
				// re-runs against the real path once it does.
				resolvedPath = await waitForPendingMediaFile(lexicalPath);
			}
		}
		if (!resolvedPath || !(await isAllowedMediaPath(resolvedPath))) {
			if (pendingApproved && !resolvedPath) {
				// Pending-approved path that never appeared: not found (kept distinct
				// from the forbidden response used for unapproved paths).
				response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
				response.end("Not Found");
				return;
			}
			console.warn(`[media-server] Blocked access to unapproved path: ${rawPath}`);
			response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Forbidden");
			return;
		}

		const stat = await fs.stat(resolvedPath);
		if (!stat.isFile()) {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not Found");
			return;
		}

		const contentType = getMediaContentType(resolvedPath);
		const fileSize = stat.size;
		const rangeHeader = request.headers.range;

		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Credentials": "false",
			"Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
		};

		if (request.method === "OPTIONS") {
			response.writeHead(204, {
				...corsHeaders,
				"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
				"Access-Control-Allow-Headers": "Range",
			});
			response.end();
			return;
		}

		if (rangeHeader) {
			if (fileSize === 0) {
				response.writeHead(416, { ...corsHeaders, "Content-Range": `bytes */0` });
				response.end();
				return;
			}

			const byteRange = resolveHttpByteRange(rangeHeader, fileSize);
			if (!byteRange) {
				response.writeHead(416, { ...corsHeaders, "Content-Range": `bytes */${fileSize}` });
				response.end();
				return;
			}

			const { start, end } = byteRange;

			const chunkSize = end - start + 1;
			response.writeHead(206, {
				...corsHeaders,
				"Content-Range": `bytes ${start}-${end}/${fileSize}`,
				"Accept-Ranges": "bytes",
				"Content-Length": String(chunkSize),
				"Content-Type": contentType,
				"Cache-Control": "no-cache",
			});

			if (request.method === "HEAD") {
				response.end();
				return;
			}

			const stream = createReadStream(resolvedPath, { start, end });
			stream.pipe(response);
			stream.on("error", () => {
				if (!response.headersSent) {
					response.writeHead(500, { "Content-Type": "text/plain" });
				}
				response.end();
			});
		} else {
			response.writeHead(200, {
				...corsHeaders,
				"Accept-Ranges": "bytes",
				"Content-Length": String(fileSize),
				"Content-Type": contentType,
				"Cache-Control": "no-cache",
			});

			if (request.method === "HEAD") {
				response.end();
				return;
			}

			const stream = createReadStream(resolvedPath);
			stream.pipe(response);
			stream.on("error", () => {
				if (!response.headersSent) {
					response.writeHead(500, { "Content-Type": "text/plain" });
				}
				response.end();
			});
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not Found");
			return;
		}

		console.error("[media-server] Error handling request:", error);
		response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Internal Server Error");
	}
}

export function getMediaServerBaseUrl(): string | null {
	return mediaServerBaseUrl;
}

export async function ensureMediaServer(): Promise<string> {
	if (mediaServerBaseUrl) {
		return mediaServerBaseUrl;
	}

	if (mediaServerStartPromise) {
		return mediaServerStartPromise;
	}

	mediaServerStartPromise = new Promise((resolve, reject) => {
		const server = createServer((request, response) => {
			void handleMediaRequest(request, response);
		});

		server.once("error", (error) => {
			reject(error);
		});

		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Media server did not expose a TCP address"));
				return;
			}

			mediaServerBaseUrl = `http://127.0.0.1:${address.port}`;
			console.log(`[media-server] Listening at ${mediaServerBaseUrl}`);
			resolve(mediaServerBaseUrl);
		});
	});

	return mediaServerStartPromise;
}

export function buildMediaUrl(baseUrl: string, filePath: string): string {
	const resolved = path.resolve(filePath);
	return `${baseUrl}/video?path=${encodeURIComponent(resolved)}`;
}
