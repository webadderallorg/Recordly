export type CloudShareTicket = {
	uploadUrl: string;
	shareUrl: string;
	shareCode?: string;
	method: "PUT";
	headers: Record<string, string>;
	finalizeUrl?: string;
};

const TRUSTED_SHARE_ORIGINS = new Set([
	"https://videos.recordly.dev",
	"https://recordly-share-staging.youngchen3442.workers.dev",
	"http://localhost:8787",
	"http://127.0.0.1:8787",
]);

function parseUrl(value: unknown, label: string): URL {
	if (typeof value !== "string") throw new Error(`${label} is missing.`);
	const url = new URL(value);
	if (url.username || url.password) throw new Error(`${label} cannot contain credentials.`);
	return url;
}

export function normalizeCloudEndpoint(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("Enter a cloud share endpoint.");
	}
	const url = parseUrl(value.trim(), "Cloud share endpoint");
	if (!TRUSTED_SHARE_ORIGINS.has(url.origin)) {
		throw new Error("Cloud sharing is only allowed through the Recordly service.");
	}
	if (url.pathname !== "/api/upload" || url.search) {
		throw new Error("The cloud share endpoint is invalid.");
	}
	url.hash = "";
	return url.toString();
}

function parseHttpUrl(value: unknown, label: string): string {
	const url = parseUrl(value, `${label} from the server response`);
	const localHttp =
		url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
	if (url.protocol !== "https:" && !localHttp) {
		throw new Error(`${label} must use HTTPS (HTTP is allowed for localhost).`);
	}
	return url.toString();
}

export function parseCloudShareTicket(value: unknown): CloudShareTicket {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("The cloud share server returned an invalid response.");
	}
	const input = value as Record<string, unknown>;
	const uploadUrl = input.uploadUrl ?? input.uploadURL;
	const shareUrl = input.shareUrl ?? input.shareURL;
	const shareCode =
		typeof input.shareCode === "string" && /^[a-z0-9]+$/.test(input.shareCode)
			? input.shareCode
			: undefined;
	const method = input.method === undefined ? "PUT" : input.method;
	if (method !== "PUT") throw new Error("Only presigned PUT uploads are currently supported.");
	const headers: Record<string, string> = {};
	if (input.headers !== undefined) {
		if (!input.headers || typeof input.headers !== "object" || Array.isArray(input.headers)) {
			throw new Error("Upload headers must be an object.");
		}
		for (const [key, headerValue] of Object.entries(input.headers)) {
			if (typeof headerValue !== "string")
				throw new Error("Upload header values must be strings.");
			if (
				[
					"authorization",
					"cookie",
					"host",
					"content-length",
					"proxy-authorization",
				].includes(key.toLowerCase())
			) {
				throw new Error(`The upload header ${key} is not allowed.`);
			}
			headers[key] = headerValue;
		}
	}
	const parsedUploadUrl = parseHttpUrl(uploadUrl, "uploadUrl");
	const parsedShareUrl = parseHttpUrl(shareUrl, "shareUrl");
	let finalizeUrl: string | undefined;
	if (typeof input.finalizeUrl === "string") {
		finalizeUrl = parseHttpUrl(input.finalizeUrl, "finalizeUrl");
	} else if (typeof input.shareCode === "string" && /^[a-z0-9]+$/.test(input.shareCode)) {
		// Voom marks a recording ready after metadata is posted.
		finalizeUrl = new URL(`/api/metadata/${input.shareCode}`, parsedShareUrl).toString();
	}
	return {
		uploadUrl: parsedUploadUrl,
		shareUrl: parsedShareUrl,
		shareCode,
		method,
		headers,
		finalizeUrl,
	};
}

/** Validates untrusted library JSON before presenting recording metadata to the renderer. */
export function parseCloudRecordingList(data: unknown, endpoint: string) {
	if (!data || typeof data !== "object" || !("videos" in data) || !Array.isArray(data.videos))
		throw new Error("Invalid recordings response.");
	return data.videos.slice(0, 100).map((raw: unknown) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			throw new Error("Invalid recording response.");
		const video = raw as Record<string, unknown>;
		if (
			typeof video.share_code !== "string" ||
			!/^[a-z0-9]{1,128}$/.test(video.share_code) ||
			typeof video.title !== "string"
		)
			throw new Error("Invalid recording response.");
		const size = Number(video.file_size);
		return {
			code: video.share_code,
			title: video.title,
			size: Number.isFinite(size) && size >= 0 ? size : 0,
			createdAt: typeof video.created_at === "string" ? video.created_at : undefined,
			ready: video.upload_completed === 1,
			url: new URL(`/s/${video.share_code}`, endpoint).href,
		};
	});
}
