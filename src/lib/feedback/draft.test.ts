import { expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(() => true) }));
vi.mock("@/lib/appSettings", () => ({
	loadAppSetting: storage.load,
	saveAppSetting: storage.save,
}));

import { getFeedbackDraft, updateFeedbackDraft } from "./draft";

it("defaults to Neutral on a new draft and an empty draft saved by an older version", () => {
	storage.load.mockReturnValueOnce(null);
	expect(getFeedbackDraft("new-user").sentiment).toBe("neutral");
	storage.load.mockReturnValueOnce({ sentiment: null, message: "" });
	expect(getFeedbackDraft("old-empty-user").sentiment).toBe("neutral");
});

it("keeps a previous subject and message when loading an older draft", () => {
	storage.load.mockReturnValueOnce({ subject: "Export failed", message: "Stopped early." });
	expect(getFeedbackDraft("legacy-user")).toEqual({
		sentiment: "neutral",
		message: "Export failed\n\nStopped early.",
		files: [],
	});
});

it("persists the selected face with the message and allows explicitly clearing it", () => {
	storage.load.mockReturnValueOnce({ sentiment: "loving", message: "Great app!" });
	expect(getFeedbackDraft("sentiment-user").sentiment).toBe("loving");
	updateFeedbackDraft("sentiment-user", { sentiment: "neutral" });
	expect(storage.save).toHaveBeenLastCalledWith("recordly.feedback.draft.v1.sentiment-user", {
		sentiment: "neutral",
		message: "Great app!",
	});
	updateFeedbackDraft("sentiment-user", { sentiment: null });
	expect(getFeedbackDraft("sentiment-user").sentiment).toBeNull();
	storage.load.mockReturnValueOnce({ sentiment: null, message: "Great app!" });
	expect(getFeedbackDraft("cleared-sentiment-user").sentiment).toBeNull();
});

it("restores whitespace-only drafts as empty so the placeholder is visible", () => {
	storage.load.mockReturnValueOnce({ subject: " ", message: " \n\t " });
	expect(getFeedbackDraft("blank-user").message).toBe("");
});

it("preserves formatting in meaningful drafts and ignores a blank legacy subject", () => {
	storage.load.mockReturnValueOnce({ subject: " ", message: "  Steps:\n  1. Export\n" });
	expect(getFeedbackDraft("formatted-user").message).toBe("  Steps:\n  1. Export\n");
});
