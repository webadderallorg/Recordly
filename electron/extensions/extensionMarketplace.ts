/**
 * Extension Marketplace — Main Process
 *
 * Handles fetching, downloading, and installing extensions from the
 * Recordly marketplace API. Also provides admin review endpoints.
 */

import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { app } from "electron";
import { formatMarketplaceHttpError, getErrorMessage } from "./errorUtils";
import { getRegisteredExtensions, installExtensionFromPath } from "./extensionLoader";
import type {
	ExtensionReview,
	MarketplaceExtension,
	MarketplaceReviewStatus,
	MarketplaceSearchResult,
} from "./extensionTypes";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MARKETPLACE_API_BASE = "https://marketplace.recordly.dev/extensions/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Zip-slip protection: recursively verify all extracted files stay within the
// expected directory. Rejects symlinks that point outside and any entry whose
// real path escapes the root.
// ---------------------------------------------------------------------------

async function assertNoEscapedFiles(dir: string, root: string): Promise<void> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		const real = await fs.realpath(entryPath);
		if (!real.startsWith(root + path.sep) && real !== root) {
			// Nuke the escaped file/symlink and throw
			await fs.rm(entryPath, { recursive: true, force: true }).catch(() => undefined);
			throw new Error(
				`Zip-slip detected: ${entry.name} resolves outside extraction directory`,
			);
		}
		if (entry.isDirectory()) {
			await assertNoEscapedFiles(entryPath, root);
		}
	}
}

function getMarketplaceUrl(): string {
	// Allow explicit override for local marketplace development.
	if (process.env.RECORDLY_MARKETPLACE_URL) return process.env.RECORDLY_MARKETPLACE_URL;
	return MARKETPLACE_API_BASE;
}

function getAdminKey(): string | undefined {
	return process.env.RECORDLY_ADMIN_KEY;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function marketplaceFetch<T>(
	endpoint: string,
	options: { method?: string; body?: unknown; timeout?: number; admin?: boolean } = {},
): Promise<T> {
	const url = `${getMarketplaceUrl()}${endpoint}`;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? REQUEST_TIMEOUT_MS);

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Recordly-Version": app.getVersion(),
			"X-Recordly-Platform": process.platform,
		};

		// Attach admin key for privileged endpoints
		if (options.admin) {
			const key = getAdminKey();
			if (!key) throw new Error("Admin key not configured (set RECORDLY_ADMIN_KEY env var)");
			headers["X-Admin-Key"] = key;
		}

		const response = await fetch(url, {
			method: options.method ?? "GET",
			headers,
			body: options.body ? JSON.stringify(options.body) : undefined,
			signal: controller.signal,
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				formatMarketplaceHttpError({
					status: response.status,
					contentType: response.headers.get("content-type"),
					body: text,
				}),
			);
		}

		return (await response.json()) as T;
	} finally {
		clearTimeout(timeoutId);
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search/browse marketplace extensions.
 */
export async function searchMarketplace(params: {
	query?: string;
	tags?: string[];
	sort?: "popular" | "recent" | "rating";
	page?: number;
	pageSize?: number;
}): Promise<MarketplaceSearchResult> {
	const searchParams = new URLSearchParams();
	if (params.query) searchParams.set("query", params.query);
	if (params.tags?.length) searchParams.set("tags", params.tags.join(","));
	if (params.sort) searchParams.set("sort", params.sort);
	if (params.page) searchParams.set("page", String(params.page));
	if (params.pageSize) searchParams.set("pageSize", String(params.pageSize));

	const qs = searchParams.toString();
	const result = await marketplaceFetch<MarketplaceSearchResult>(
		`/extensions${qs ? `?${qs}` : ""}`,
	);

	// Mark installed extensions
	const installed = getRegisteredExtensions();
	const installedIds = new Set(installed.map((e) => e.manifest.id));
	for (const ext of result.extensions) {
		ext.installed = installedIds.has(ext.id);
	}

	return result;
}

/**
 * Get a single marketplace extension by ID.
 */
export async function getMarketplaceExtension(id: string): Promise<MarketplaceExtension | null> {
	try {
		const ext = await marketplaceFetch<MarketplaceExtension>(
			`/extensions/${encodeURIComponent(id)}`,
		);
		const installed = getRegisteredExtensions();
		ext.installed = installed.some((e) => e.manifest.id === ext.id);
		return ext;
	} catch {
		return null;
	}
}

/**
 * Download and install a marketplace extension.
 * Downloads the zip, extracts it to a temp dir, then installs from there.
 */
export async function downloadAndInstallExtension(
	extensionId: string,
	downloadUrl: string,
): Promise<{ success: boolean; error?: string }> {
	// Validate download URL against allowed marketplace origins
	const allowedOrigins = [
		"https://marketplace.recordly.dev",
		"https://recordly.dev",
		...(app.isPackaged ? [] : ["http://localhost:3001"]),
	];
	try {
		const url = new URL(downloadUrl);
		if (!allowedOrigins.some((o) => url.origin === o)) {
			return { success: false, error: `Untrusted download origin: ${url.origin}` };
		}
	} catch {
		return { success: false, error: "Invalid download URL" };
	}

	const tempDir = path.join(app.getPath("temp"), `recordly-ext-${extensionId}-${Date.now()}`);
	const zipPath = path.join(tempDir, "extension.zip");

	try {
		// Create temp directory
		await fs.mkdir(tempDir, { recursive: true });

		// Download the archive
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 60_000);

		let response: Response;
		try {
			response = await fetch(downloadUrl, {
				signal: controller.signal,
				headers: {
					"X-Recordly-Version": app.getVersion(),
				},
			});
		} finally {
			clearTimeout(timeoutId);
		}

		if (!response.ok) {
			throw new Error(`Download failed with status ${response.status}`);
		}

		if (!response.body) {
			throw new Error("Download response has no body");
		}

		// Write to disk
		const fileStream = createWriteStream(zipPath);
		await pipeline(Readable.fromWeb(response.body as NodeReadableStream), fileStream);

		// Extract the zip — use the built-in decompress or shell unzip
		const extractDir = path.join(tempDir, "extracted");
		await fs.mkdir(extractDir, { recursive: true });

		// Use Node's built-in unzip capability via child_process (execFile — no shell)
		const { execFile } = await import("node:child_process");
		await new Promise<void>((resolve, reject) => {
			if (process.platform === "win32") {
				// Use -LiteralPath to avoid PowerShell injection via single-quote in paths
				execFile(
					"powershell",
					[
						"-NoProfile",
						"-NonInteractive",
						"-command",
						"Expand-Archive",
						"-LiteralPath",
						zipPath,
						"-DestinationPath",
						extractDir,
						"-Force",
					],
					(error) => {
						if (error) reject(error);
						else resolve();
					},
				);
			} else {
				execFile("unzip", ["-o", zipPath, "-d", extractDir], (error) => {
					if (error) reject(error);
					else resolve();
				});
			}
		});

		// Security: verify no extracted file escaped the extraction directory
		// (protects against zip-slip / path traversal entries in malicious archives)
		// Use fs.realpath so the root matches what fs.realpath returns for children
		// (on macOS /var is a symlink to /private/var — path.resolve does not
		// resolve symlinks, so root and children would mismatch).
		const resolvedExtractDir = await fs.realpath(extractDir);
		await assertNoEscapedFiles(resolvedExtractDir, resolvedExtractDir);

		// Find the manifest — it might be in a subfolder
		const entries = await fs.readdir(extractDir, { withFileTypes: true });
		let manifestDir = extractDir;

		// If there's a single directory, look inside it for the manifest.
		const dirs = entries.filter((e) => e.isDirectory());
		if (dirs.length === 1 && !existsSync(path.join(extractDir, "recordly-extension.json"))) {
			manifestDir = path.join(extractDir, dirs[0].name);
		}

		// Verify manifest exists
		if (!existsSync(path.join(manifestDir, "recordly-extension.json"))) {
			throw new Error(
				"Downloaded extension does not contain a recordly-extension.json manifest",
			);
		}

		// Install from the extracted directory
		const info = await installExtensionFromPath(manifestDir);
		if (!info) {
			throw new Error("Extension validation failed after download");
		}

		// Track download count (fire-and-forget — CDN may cache the GET, so POST separately)
		fetch(`${getMarketplaceUrl()}/extensions/${encodeURIComponent(extensionId)}/download`, {
			method: "POST",
			headers: { "X-Recordly-Version": app.getVersion() },
		}).catch(() => undefined);

		return { success: true };
	} catch (error: unknown) {
		return { success: false, error: getErrorMessage(error) };
	} finally {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

// ---------------------------------------------------------------------------
// Review System (Admin)
// ---------------------------------------------------------------------------

/**
 * Fetch extensions pending review (admin only).
 */
export async function fetchPendingReviews(params: {
	status?: MarketplaceReviewStatus;
	page?: number;
	pageSize?: number;
}): Promise<{ reviews: ExtensionReview[]; total: number }> {
	const searchParams = new URLSearchParams();
	if (params.status) searchParams.set("status", params.status);
	if (params.page) searchParams.set("page", String(params.page));
	if (params.pageSize) searchParams.set("pageSize", String(params.pageSize));

	const qs = searchParams.toString();
	return marketplaceFetch<{ reviews: ExtensionReview[]; total: number }>(
		`/admin/reviews${qs ? `?${qs}` : ""}`,
		{ admin: true },
	);
}

/**
 * Update the review status of a submitted extension (admin only).
 */
export async function updateReviewStatus(
	reviewId: string,
	status: MarketplaceReviewStatus,
	notes?: string,
): Promise<{ success: boolean }> {
	return marketplaceFetch<{ success: boolean }>(
		`/admin/reviews/${encodeURIComponent(reviewId)}`,
		{
			method: "PATCH",
			body: { status, notes },
			admin: true,
		},
	);
}

/**
 * Submit an extension for marketplace review.
 */
export async function submitExtensionForReview(
	extensionId: string,
): Promise<{ success: boolean; reviewId?: string; error?: string }> {
	try {
		return await marketplaceFetch<{ success: boolean; reviewId?: string }>(
			`/extensions/${encodeURIComponent(extensionId)}/submit`,
			{ method: "POST" },
		);
	} catch (error: unknown) {
		return { success: false, error: getErrorMessage(error) };
	}
}
