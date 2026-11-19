import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getPackagedRendererBaseUrl } from "./rendererServer";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { approvedLocalReadPaths } from "./ipc/state";
import { getMediaContentType } from "./mediaTypes";

const mediaCapabilitySecret = randomBytes(32);

function mediaCapability(filePath: string): string {
	return createHmac("sha256", mediaCapabilitySecret).update(filePath).digest("hex");
}

function isTrustedMediaOrigin(origin: string): boolean {
	// loadFile is the renderer-server startup fallback. Opaque origins still
	// require the per-file capability below; Origin:null alone grants no access.
	if (origin === "null") return true;
	const allowedUrls = [getPackagedRendererBaseUrl(), process.env.VITE_DEV_SERVER_URL];
	return allowedUrls.some((value) => {
		if (!value) return false;
		try {
			return new URL(value).origin === origin;
		} catch {
			return false;
		}
	});
}

let mediaServerBaseUrl: string | null = null;
let mediaServerStartPromise: Promise<string> | null = null;

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

export function isAllowedMediaPath(realPath: string): boolean {
	return approvedLocalReadPaths.has(realPath);
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

		if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "")) {
			response.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
			response.end();
			return;
		}

		const origin = request.headers.origin;
		if (origin && !isTrustedMediaOrigin(origin)) {
			response.writeHead(403);
			response.end("Forbidden");
			return;
		}

		const rawPath = url.searchParams.get("path");
		if (!rawPath) {
			response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Missing path parameter");
			return;
		}

		// A per-file capability prevents websites and other local clients from
		// guessing an approved recording path and reading it through loopback.
		const capability = url.searchParams.get("token") ?? "";
		const expected = mediaCapability(rawPath);
		if (
			!/^[a-f0-9]{64}$/.test(capability) ||
			!timingSafeEqual(Buffer.from(capability), Buffer.from(expected))
		) {
			response.writeHead(403);
			response.end("Forbidden");
			return;
		}

		const resolvedPath = await resolveRealPath(rawPath);
		if (!resolvedPath || !isAllowedMediaPath(resolvedPath)) {
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
			...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
			Vary: "Origin",
			"X-Content-Type-Options": "nosniff",
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

export function createMediaServer() {
	return createServer((request, response) => {
		void handleMediaRequest(request, response);
	});
}

export async function ensureMediaServer(): Promise<string> {
	if (mediaServerBaseUrl) {
		return mediaServerBaseUrl;
	}

	if (mediaServerStartPromise) {
		return mediaServerStartPromise;
	}

	mediaServerStartPromise = new Promise((resolve, reject) => {
		const server = createMediaServer();

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

	try {
		return await mediaServerStartPromise;
	} finally {
		mediaServerStartPromise = null;
	}
}

export function buildMediaUrl(baseUrl: string, filePath: string): string {
	const resolved = path.resolve(filePath);
	return `${baseUrl}/video?path=${encodeURIComponent(resolved)}&token=${mediaCapability(resolved)}`;
}
