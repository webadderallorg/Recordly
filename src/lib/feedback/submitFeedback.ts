import { translate } from "@/i18n/runtime";
import { recordlyAuth } from "@/lib/auth/recordlyAuth";

export class FeedbackError extends Error {}

const feedbackMessageKeys: Record<string, string> = {
	"Feedback is unavailable until account services are configured.": "unavailable",
	"Please sign in again to send feedback.": "signIn",
	"Check your subject and description, then try again.": "invalid",
	"Attach up to 5 nonempty files totaling 50 MB or less.": "attachments",
	"The feedback limit was reached. Try removing your attachments or sending again later.":
		"limitRetry",
	"The attachment upload expired. Send again to restart it.": "uploadExpired",
	"Could not send feedback. Please try again.": "sendFailed",
};
export function feedbackErrorMessage(error: unknown) {
	const message =
		error instanceof FeedbackError
			? error.message
			: "Could not send feedback. Please try again.";
	const key = feedbackMessageKeys[message];
	return key ? translate(`common.feedback.errors.${key}`, message) : message;
}

const submissionErrors: Record<string, string> = {
	SIGN_IN_REQUIRED: "Please sign in again to send feedback.",
	INVALID_FEEDBACK: "Check your subject and description, then try again.",
	INVALID_ATTACHMENTS: "Attach up to 5 nonempty files totaling 50 MB or less.",
	FEEDBACK_LIMIT:
		"The feedback limit was reached. Try removing your attachments or sending again later.",
	UPLOAD_EXPIRED: "The attachment upload expired. Send again to restart it.",
};

export const MAX_FILES = 5;
export const MAX_BYTES = 50 * 1024 * 1024;
const LEGACY_BYTES = 10 * 1024 * 1024;
const CHUNK_BYTES = 6 * 1024 * 1024;
// Keyed by the attachment list: editing the text keeps the report ID, so a retry
// resumes the same reservation instead of charging the daily budget again.
const drafts = new WeakMap<File[], { id: string; userId: string }>();
export function validateAttachments(files: File[]) {
	if (files.length > MAX_FILES)
		return translate("common.feedback.errors.tooManyFiles", "Attach up to 5 files.");
	if (files.some((file) => file.size === 0))
		return translate("common.feedback.errors.emptyFile", "Empty files cannot be attached.");
	if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES)
		return translate(
			"common.feedback.errors.filesTooLarge",
			"Attachments must total 50 MB or less.",
		);
	return null;
}
// The Edge handler limits titles by UTF-16 length, not by code-point count.
export function normalizeFeedbackTitle(value: string) {
	const singleLine = value.replace(/\s+/gu, " ").trim();
	let title = "";
	for (const character of singleLine) {
		if (title.length + character.length > 160) break;
		title += character;
	}
	return title.trimEnd();
}
export async function submitFeedback(input: {
	title: string;
	subject: string;
	message: string;
	files: File[];
	logs: string | null;
	onUploadProgress?: (percent: number) => void;
}) {
	const client = recordlyAuth;
	if (!client)
		throw new FeedbackError("Feedback is unavailable until account services are configured.");
	const { data, error } = await client.auth.getUser();
	if (error || !data.user) throw new FeedbackError("Please sign in again to send feedback.");
	const validation = validateAttachments(input.files);
	if (validation) throw new FeedbackError(validation);
	const payload = {
		title: normalizeFeedbackTitle(input.title),
		subject: input.subject,
		message: input.message.trim(),
		logs: input.logs,
	};
	async function invoke<T>(body: object | Blob | FormData, query = "") {
		const result = await client?.functions.invoke<T>(`submit-feedback${query}`, {
			body,
			timeout: 60_000,
		});
		if (!result) throw new Error("Feedback client is unavailable");
		if (result.error) {
			const response = result.error.context;
			if (response instanceof Response) {
				if (response.status === 401)
					throw new FeedbackError(submissionErrors.SIGN_IN_REQUIRED);
				const payload = await response.json().catch(() => null);
				if (
					typeof payload?.code === "string" &&
					Object.keys(submissionErrors).includes(payload.code)
				) {
					if (payload.code === "UPLOAD_EXPIRED") drafts.delete(input.files);
					throw new FeedbackError(submissionErrors[payload.code]);
				}
			}
			throw result.error;
		}
		return result.data;
	}
	const total = input.files.reduce((sum, file) => sum + file.size, 0);
	if (total <= LEGACY_BYTES) {
		const body = new FormData();
		body.set("title", payload.title);
		body.set("subject", payload.subject);
		body.set("message", payload.message);
		if (payload.logs !== null) body.set("logs", payload.logs);
		for (const file of input.files) body.append("files", file);
		const result = await invoke<{ success?: boolean }>(body);
		if (result?.success !== true) throw new Error("Feedback submission was not confirmed");
		return;
	}

	const userId = data.user.id;
	const existing = drafts.get(input.files);
	const id = existing?.userId === userId ? existing.id : crypto.randomUUID();
	drafts.set(input.files, { id, userId });
	const query = (action: string, other = "") => `?upload=${action}&id=${id}${other}`;
	const prepared = await invoke<{ success?: boolean; saved?: boolean }>(
		{
			files: input.files.map(({ name, type, size }) => ({ name, type, size })),
		},
		query("prepare"),
	);
	if (prepared?.success !== true) throw new Error("Feedback upload was not initialized");
	if (!prepared.saved) {
		let uploaded = 0;
		for (const [index, file] of input.files.entries()) {
			const slot = `&file=${index}`;
			const state = await invoke<{ offset: number }>({}, query("offset", slot));
			if (
				!state ||
				!Number.isSafeInteger(state.offset) ||
				state.offset < 0 ||
				state.offset > file.size ||
				(state.offset !== file.size && state.offset % CHUNK_BYTES !== 0)
			)
				throw new Error("Invalid feedback upload offset");
			let offset: number = state.offset;
			const progress = (bytes: number) =>
				input.onUploadProgress?.(Math.floor(((uploaded + bytes) / total) * 100));
			progress(offset);
			while (offset < file.size) {
				const end = Math.min(offset + CHUNK_BYTES, file.size);
				const chunk = file.slice(offset, end, "application/octet-stream");
				const result = await invoke<{ offset: number }>(
					chunk,
					query("chunk", `${slot}&offset=${offset}`),
				);
				if (result?.offset !== end) throw new Error("Feedback chunk was not confirmed");
				offset = end;
				progress(offset);
			}
			uploaded += file.size;
		}
		const result = await invoke<{ success?: boolean }>(payload, query("finish"));
		if (result?.success !== true) throw new Error("Feedback submission was not confirmed");
	}
	drafts.delete(input.files);
}
