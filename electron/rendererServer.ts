import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { resolveHttpByteRange } from "./httpByteRange";

const MIME_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".mjs": "text/javascript; charset=utf-8",
	".m4a": "audio/mp4",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".wasm": "application/wasm",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

let packagedRendererBaseUrl: string | null = null;
let packagedRendererServerStartPromise: Promise<string> | null = null;

function getContentType(filePath: string): string {
	return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function getCacheControl(filePath: string): string {
	// Vite fingerprints production assets, so they can be reused across the HUD,
	// picker, toast, and editor windows without revalidation. Keep index.html
	// uncached because it points at the current fingerprinted files.
	return /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(path.basename(filePath))
		? "public, max-age=31536000, immutable"
		: "no-cache";
}

function resolveRequestedFilePath(rootDir: string, requestPathname: string): string | null {
	const trimmedPathname = requestPathname === "/" ? "/index.html" : requestPathname;

	// path.normalize() on Windows converts / to \, making the leading-slash
	// regex fail and causing path.resolve to escape to the drive root.
	const normalizedPosix = path.posix.normalize(decodeURIComponent(trimmedPathname));
	const relativePath = normalizedPosix.replace(/^\/+/, "");

	if (!relativePath) {
		return null;
	}

	const resolvedRootDir = path.resolve(rootDir);
	const resolvedFilePath = path.resolve(resolvedRootDir, relativePath);

	if (
		resolvedFilePath !== resolvedRootDir &&
		!resolvedFilePath.startsWith(`${resolvedRootDir}${path.sep}`)
	) {
		return null;
	}

	return resolvedFilePath;
}

function pipeFileStream(
	filePath: string,
	response: ServerResponse,
	range?: { start: number; end: number },
): void {
	const stream = range ? createReadStream(filePath, range) : createReadStream(filePath);
	response.once("close", () => {
		if (!stream.destroyed) {
			stream.destroy();
		}
	});
	stream.on("error", () => {
		if (!response.headersSent) {
			response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Internal Server Error");
			return;
		}
		response.destroy();
	});
	stream.pipe(response);
}

async function servePackagedRendererRequest(
	rootDir: string,
	assetRoot: string,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	try {
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405, { Allow: "GET, HEAD" });
			response.end();
			return;
		}
		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const assetPrefix = "/__recordly_assets/";
		const isBundledAsset = requestUrl.pathname.startsWith(assetPrefix);
		const resolvedFilePath = resolveRequestedFilePath(
			isBundledAsset ? assetRoot : rootDir,
			isBundledAsset ? requestUrl.pathname.slice(assetPrefix.length) : requestUrl.pathname,
		);

		if (!resolvedFilePath) {
			response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Forbidden");
			return;
		}

		const filePath = resolvedFilePath;
		const stat = await fs.stat(filePath);
		if (!stat.isFile()) {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not Found");
			return;
		}

		const fileSize = stat.size;
		const baseHeaders: Record<string, string> = {
			"X-Content-Type-Options": "nosniff",
			...(path.extname(filePath) === ".html" && {
				"Content-Security-Policy": "frame-ancestors 'none'",
			}),
			"Cache-Control": getCacheControl(filePath),
			"Content-Type": getContentType(filePath),
			"Accept-Ranges": "bytes",
		};

		const rangeHeader = request.headers.range;
		if (rangeHeader) {
			const byteRange = resolveHttpByteRange(rangeHeader, fileSize);
			if (!byteRange) {
				response.writeHead(416, {
					"X-Content-Type-Options": "nosniff",
					"Content-Range": `bytes */${fileSize}`,
				});
				response.end();
				return;
			}

			const { start, end } = byteRange;
			const chunkSize = end - start + 1;
			response.writeHead(206, {
				...baseHeaders,
				"Content-Range": `bytes ${start}-${end}/${fileSize}`,
				"Content-Length": String(chunkSize),
			});

			if (request.method === "HEAD") {
				response.end();
				return;
			}

			pipeFileStream(filePath, response, { start, end });
			return;
		}

		response.writeHead(200, {
			...baseHeaders,
			"Content-Length": String(fileSize),
		});

		if (request.method === "HEAD") {
			response.end();
			return;
		}

		pipeFileStream(filePath, response);
	} catch (error) {
		if (response.headersSent) {
			response.destroy();
			return;
		}
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not Found");
			return;
		}

		response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Internal Server Error");
	}
}

export function getPackagedRendererBaseUrl(): string | null {
	return packagedRendererBaseUrl;
}

export function createPackagedRendererServer(rootDir: string, assetRoot: string) {
	return createServer((request, response) => {
		void servePackagedRendererRequest(rootDir, assetRoot, request, response);
	});
}

export async function ensurePackagedRendererServer(
	rootDir: string,
	assetRoot = path.join(process.resourcesPath, "assets"),
): Promise<string> {
	if (packagedRendererBaseUrl) {
		return packagedRendererBaseUrl;
	}

	if (packagedRendererServerStartPromise) {
		return packagedRendererServerStartPromise;
	}

	packagedRendererServerStartPromise = new Promise((resolve, reject) => {
		const server = createPackagedRendererServer(rootDir, assetRoot);

		server.once("error", (error) => {
			reject(error);
		});

		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Renderer server did not expose a TCP address"));
				return;
			}

			packagedRendererBaseUrl = `http://127.0.0.1:${address.port}`;
			resolve(packagedRendererBaseUrl);
		});
	});

	try {
		return await packagedRendererServerStartPromise;
	} finally {
		packagedRendererServerStartPromise = null;
	}
}
