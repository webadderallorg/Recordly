import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

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

async function servePackagedRendererRequest(
	rootDir: string,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	try {
		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const resolvedFilePath = resolveRequestedFilePath(rootDir, requestUrl.pathname);

		if (!resolvedFilePath) {
			response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Forbidden");
			return;
		}

		const filePath = resolvedFilePath;
		const fileContents = await fs.readFile(filePath);

		response.writeHead(200, {
			"Cache-Control": getCacheControl(filePath),
			"Content-Type": getContentType(filePath),
		});

		if (request.method === "HEAD") {
			response.end();
			return;
		}

		response.end(fileContents);
	} catch (error) {
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

export async function ensurePackagedRendererServer(rootDir: string): Promise<string> {
	if (packagedRendererBaseUrl) {
		return packagedRendererBaseUrl;
	}

	if (packagedRendererServerStartPromise) {
		return packagedRendererServerStartPromise;
	}

	packagedRendererServerStartPromise = new Promise((resolve, reject) => {
		const server = createServer((request, response) => {
			void servePackagedRendererRequest(rootDir, request, response);
		});

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
