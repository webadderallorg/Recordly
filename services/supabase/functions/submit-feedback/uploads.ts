import { feedbackJson, feedbackPayload, notifySavedFeedback, readBoundedBody } from "./handler.ts";

export const CHUNK_BYTES = 6 * 1024 * 1024;
const MAX_BYTES = 50 * 1024 * 1024;
export const FEEDBACK_BUCKET = "feedback-attachments";
export type Attachment = { name: string; type: string; size: number };
export interface UploadBackend {
	authenticate(token: string): Promise<string | null>;
	prepare(user: string, id: string, files: Attachment[]): Promise<string>;
	find(
		user: string,
		id: string,
	): Promise<{ files: Attachment[]; urls: Record<string, string> } | null>;
	saveUrl(user: string, id: string, slot: string, url: string): Promise<string | null>;
	finish(
		user: string,
		id: string,
		payload: NonNullable<ReturnType<typeof feedbackPayload>>,
	): Promise<string>;
	create(path: string, size: number): Promise<string>;
	offset(url: string, size: number): Promise<number>;
	append(url: string, start: number, data: Uint8Array<ArrayBuffer>): Promise<number | null>;
	notify(id: string): Promise<void>;
}

function isAttachment(item: unknown): item is Attachment {
	if (typeof item !== "object" || item === null) return false;
	const f = item as Partial<Attachment>;
	return (
		typeof f.name === "string" &&
		!!f.name &&
		f.name.length <= 255 &&
		typeof f.type === "string" &&
		f.type.length <= 255 &&
		typeof f.size === "number" &&
		Number.isSafeInteger(f.size) &&
		f.size > 0 &&
		f.size <= MAX_BYTES
	);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reject = (status: number, code: string) => feedbackJson(status, { code });

export function feedbackUploads(backend: UploadBackend) {
	return async (request: Request, url: URL) => {
		if (request.method !== "POST") return reject(405, "METHOD_NOT_ALLOWED");
		const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
		const id = url.searchParams.get("id") ?? "";
		const action = url.searchParams.get("upload");
		if (!token) return reject(401, "SIGN_IN_REQUIRED");
		if (!uuid.test(id)) return reject(400, "INVALID_FEEDBACK");
		try {
			const user = await backend.authenticate(token);
			if (!user) return reject(401, "SIGN_IN_REQUIRED");
			if (action === "prepare" || action === "finish") {
				let body;
				try {
					body = JSON.parse(
						new TextDecoder().decode(await readBoundedBody(request, 1024 * 1024)),
					);
				} catch {
					return reject(400, "INVALID_FEEDBACK");
				}
				if (action === "prepare") {
					const files: unknown = body?.files;
					if (
						!Array.isArray(files) ||
						files.length < 1 ||
						files.length > 5 ||
						!files.every(isAttachment) ||
						files.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES
					)
						return reject(400, "INVALID_ATTACHMENTS");
					const manifest = files.map(({ name, type, size }) => ({ name, type, size }));
					const state = await backend.prepare(user, id, manifest);
					if (state === "limit") return reject(429, "FEEDBACK_LIMIT");
					if (state === "ready" || state === "saved")
						return feedbackJson(200, { success: true, saved: state === "saved" });
					return reject(409, "UPLOAD_EXPIRED");
				}
				const payload = feedbackPayload(
					body?.title,
					body?.message,
					body?.subject,
					body?.logs ?? null,
				);
				if (!payload) return reject(400, "INVALID_FEEDBACK");
				const state = await backend.finish(user, id, payload);
				if (state === "new") await notifySavedFeedback(backend.notify, id);
				if (state === "new" || state === "saved")
					return feedbackJson(200, { success: true });
				return reject(409, state === "incomplete" ? "UPLOAD_INCOMPLETE" : "UPLOAD_EXPIRED");
			}
			if (action !== "offset" && action !== "chunk") return reject(400, "INVALID_FEEDBACK");
			const slot = url.searchParams.get("file") ?? "";
			if (!/^[0-4]$/.test(slot)) return reject(400, "INVALID_ATTACHMENTS");
			const pending = await backend.find(user, id);
			if (!pending) return reject(409, "UPLOAD_EXPIRED");
			const file = pending.files[Number(slot)];
			if (!file) return reject(400, "INVALID_ATTACHMENTS");
			let upload = pending.urls[slot];
			if (action === "offset") {
				if (!upload) {
					const candidate = await backend.create(`${user}/${id}/${slot}`, file.size);
					upload = (await backend.saveUrl(user, id, slot, candidate)) ?? "";
					if (!upload) return reject(409, "UPLOAD_EXPIRED");
				}
				return feedbackJson(200, { offset: await backend.offset(upload, file.size) });
			}
			const start = Number(url.searchParams.get("offset") ?? "NaN");
			if (
				!upload ||
				!Number.isSafeInteger(start) ||
				start < 0 ||
				start >= file.size ||
				start % CHUNK_BYTES !== 0
			)
				return reject(409, "UPLOAD_INCOMPLETE");
			const length = Math.min(CHUNK_BYTES, file.size - start);
			let chunk: Uint8Array<ArrayBuffer>;
			try {
				chunk = await readBoundedBody(request, length);
			} catch {
				return reject(400, "INVALID_ATTACHMENTS");
			}
			if (chunk.byteLength !== length) return reject(400, "INVALID_ATTACHMENTS");
			const next = await backend.append(upload, start, chunk);
			if (next !== start + length) return reject(409, "UPLOAD_INCOMPLETE");
			return feedbackJson(200, { offset: next });
		} catch (error) {
			console.error(
				"Feedback upload failed",
				action,
				error instanceof Error ? error.message : "Unknown error",
			);
			return reject(500, "SUBMISSION_FAILED");
		}
	};
}

export function storageTus(supabaseUrl: string, secret: string) {
	const origin = new URL(supabaseUrl);
	if (origin.hostname.endsWith(".supabase.co"))
		origin.hostname = origin.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
	const endpoint = "/storage/v1/upload/resumable";
	const common = { Authorization: `Bearer ${secret}`, apikey: secret, "Tus-Resumable": "1.0.0" };
	const uploadPath = (location: string) => {
		const path = new URL(location, origin).pathname;
		if (!new RegExp(`^${endpoint}/[a-zA-Z0-9_=+-]+$`).test(path))
			throw new Error("Invalid Storage upload location");
		return path;
	};
	const request = (path: string, init: RequestInit) =>
		fetch(new URL(path, origin), {
			...init,
			redirect: "error",
			signal: AbortSignal.timeout(40_000),
			headers: { ...common, ...init.headers },
		});
	const readOffset = (response: Response) =>
		Number(response.headers.get("Upload-Offset") ?? "NaN");
	return {
		async create(path: string, size: number) {
			const response = await request(endpoint, {
				method: "POST",
				headers: {
					"Upload-Length": String(size),
					"Upload-Metadata": `bucketName ${btoa(FEEDBACK_BUCKET)},objectName ${btoa(path)},contentType ${btoa("application/octet-stream")}`,
				},
			});
			await response.body?.cancel();
			const location = response.headers.get("Location");
			if (response.status !== 201 || !location)
				throw new Error(`Storage initialization returned HTTP ${response.status}`);
			return uploadPath(location);
		},
		async offset(url: string, size: number) {
			const response = await request(uploadPath(url), { method: "HEAD" });
			const offset = readOffset(response);
			if (!response.ok || !Number.isSafeInteger(offset) || offset < 0 || offset > size)
				throw new Error(
					`Storage offset returned HTTP ${response.status} or invalid offset`,
				);
			return offset;
		},
		async append(url: string, start: number, body: Uint8Array<ArrayBuffer>) {
			const response = await request(uploadPath(url), {
				method: "PATCH",
				headers: {
					"Upload-Offset": String(start),
					"Content-Type": "application/offset+octet-stream",
				},
				body,
			});
			await response.body?.cancel();
			if (response.status === 409) return null;
			if (!response.ok) throw new Error(`Storage upload returned HTTP ${response.status}`);
			return readOffset(response);
		},
	};
}
