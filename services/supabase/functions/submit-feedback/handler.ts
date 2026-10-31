const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_BYTES + 1024 * 1024;
const headers = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Content-Type": "application/json",
};
export interface FeedbackBackend {
	authenticate(token: string): Promise<string | null>;
	reserve(userId: string, files: number, bytes: number): Promise<boolean>;
	upload(path: string, file: File): Promise<void>;
	insert(report: Record<string, unknown>): Promise<void>;
	remove(paths: string[]): Promise<void>;
}
const reply = (status: number, code?: string) =>
	new Response(JSON.stringify(code ? { code } : { success: true }), { status, headers });

// Bound the actual body, not just the caller's Content-Length header.
async function readForm(request: Request) {
	const reader = request.body?.getReader();
	if (!reader) throw new Error("Missing body");
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_REQUEST_BYTES) throw new Error("Body too large");
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
	const body = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new Response(body, {
		headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
	}).formData();
}

export function feedbackHandler(backend: FeedbackBackend) {
	return async (request: Request): Promise<Response> => {
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
		if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
		const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
		if (!token) return reply(401, "SIGN_IN_REQUIRED");
		const uploaded: string[] = [];
		try {
			const userId = await backend.authenticate(token);
			if (!userId) return reply(401, "SIGN_IN_REQUIRED");
			let form: FormData;
			try {
				form = await readForm(request);
			} catch {
				return reply(400, "INVALID_FEEDBACK");
			}
			const title = form.get("title");
			const message = form.get("message");
			const subject = form.get("subject");
			const logs = form.get("logs");
			const files = form.getAll("files");
			if (
				typeof title !== "string" ||
				!title.trim() ||
				title.trim().length > 160 ||
				typeof message !== "string" ||
				!message.trim() ||
				message.trim().length > 10000 ||
				typeof subject !== "string" ||
				!["bug", "idea", "question", "other"].includes(subject) ||
				(logs !== null &&
					(typeof logs !== "string" || new TextEncoder().encode(logs).length > 300000))
			) {
				return reply(400, "INVALID_FEEDBACK");
			}
			if (
				files.length > MAX_FILES ||
				files.some((file) => typeof file === "string" || file.size === 0)
			) {
				return reply(400, "INVALID_ATTACHMENTS");
			}
			const attachments = files as File[];
			const bytes = attachments.reduce((total, file) => total + file.size, 0);
			if (bytes > MAX_BYTES) return reply(400, "INVALID_ATTACHMENTS");
			if (!(await backend.reserve(userId, attachments.length, bytes)))
				return reply(429, "FEEDBACK_LIMIT");
			const id = crypto.randomUUID();
			const metadata = [];
			for (const file of attachments) {
				const path = `${userId}/${id}/${crypto.randomUUID()}`;
				await backend.upload(path, file);
				uploaded.push(path);
				metadata.push({ path, name: file.name, size: file.size, type: file.type });
			}
			await backend.insert({
				id,
				user_id: userId,
				title: title.trim(),
				subject,
				message: message.trim(),
				logs,
				attachments: metadata,
			});
			return reply(200);
		} catch {
			if (uploaded.length) await backend.remove(uploaded).catch(() => undefined);
			return reply(500, "SUBMISSION_FAILED");
		}
	};
}
