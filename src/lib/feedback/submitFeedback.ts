import { recordlyAuth } from "@/lib/auth/recordlyAuth";

export class FeedbackError extends Error {}

export function feedbackErrorMessage(error: unknown) {
	return error instanceof FeedbackError
		? error.message
		: "Could not send feedback. Please try again.";
}

const submissionErrors: Record<string, string> = {
	SIGN_IN_REQUIRED: "Please sign in again to send feedback.",
	INVALID_FEEDBACK: "Check your subject and description, then try again.",
	INVALID_ATTACHMENTS: "Attach up to 5 nonempty files totaling 10 MB or less.",
	FEEDBACK_LIMIT: "You’ve reached today’s feedback limit. Please try again tomorrow.",
};

export const MAX_FILES = 5;
export const MAX_BYTES = 10 * 1024 * 1024;
export function validateAttachments(files: File[]) {
	if (files.length > MAX_FILES) return "Attach up to 5 files.";
	if (files.some((file) => file.size === 0)) return "Empty files cannot be attached.";
	if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES)
		return "Attachments must total 10 MB or less.";
	return null;
}
export async function submitFeedback(input: {
	title: string;
	subject: string;
	message: string;
	files: File[];
	logs: string | null;
}) {
	const client = recordlyAuth;
	if (!client)
		throw new FeedbackError("Feedback is unavailable until account services are configured.");
	const { data, error } = await client.auth.getUser();
	if (error || !data.user) throw new FeedbackError("Please sign in again to send feedback.");
	const validation = validateAttachments(input.files);
	if (validation) throw new FeedbackError(validation);
	const body = new FormData();
	body.set("title", input.title.trim());
	body.set("subject", input.subject);
	body.set("message", input.message.trim());
	if (input.logs !== null) body.set("logs", input.logs);
	for (const file of input.files) body.append("files", file);
	const result = await client.functions.invoke("submit-feedback", { body, timeout: 60_000 });
	if (result.error) {
		const response = result.error.context;
		if (response instanceof Response) {
			if (response.status === 401) throw new FeedbackError(submissionErrors.SIGN_IN_REQUIRED);
			const payload = await response.json().catch(() => null);
			if (payload?.code && Object.keys(submissionErrors).includes(payload.code)) {
				throw new FeedbackError(submissionErrors[payload.code]);
			}
		}
		throw result.error;
	}
	if (result.data?.success !== true) throw new Error("Feedback submission was not confirmed");
}
