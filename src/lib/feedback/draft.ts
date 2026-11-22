import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";

export type FeedbackSentiment = "loving" | "neutral" | "angry" | null;

export type FeedbackDraft = {
	sentiment: FeedbackSentiment;
	message: string;
	files: File[];
};

const emptyDraft: FeedbackDraft = { sentiment: null, message: "", files: [] };
const drafts = new Map<string, FeedbackDraft>();
const listeners = new Set<() => void>();
const keyFor = (userId: string) => `recordly.feedback.draft.v1.${userId}`;

export function getFeedbackDraft(userId: string | undefined): FeedbackDraft {
	if (!userId) return emptyDraft;
	const cached = drafts.get(userId);
	if (cached) return cached;
	let stored: unknown = loadAppSetting(keyFor(userId));
	if (!stored) {
		try {
			stored = JSON.parse(localStorage.getItem(keyFor(userId)) ?? "null");
		} catch {
			// A draft can still survive dialog dismissal when storage is unavailable.
		}
	}
	const saved = stored as (Partial<FeedbackDraft> & { subject?: string }) | null;
	const draft: FeedbackDraft = {
		sentiment:
			saved?.sentiment === "loving" ||
			saved?.sentiment === "neutral" ||
			saved?.sentiment === "angry"
				? saved.sentiment
				: null,
		message: [saved?.subject, saved?.message]
			.filter(
				(value): value is string => typeof value === "string" && value.trim().length > 0,
			)
			.join("\n\n")
			.slice(0, 10000),
		files: [],
	};
	drafts.set(userId, draft);
	return draft;
}

export function updateFeedbackDraft(userId: string, patch: Partial<FeedbackDraft>) {
	const draft = { ...getFeedbackDraft(userId), ...patch };
	drafts.set(userId, draft);
	const text = { sentiment: draft.sentiment, message: draft.message };
	if (!saveAppSetting(keyFor(userId), text)) {
		try {
			localStorage.setItem(keyFor(userId), JSON.stringify(text));
		} catch {
			// File objects remain in memory; never serialize attachments into settings.
		}
	}
	for (const listener of listeners) listener();
}

export function subscribeFeedbackDraft(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
