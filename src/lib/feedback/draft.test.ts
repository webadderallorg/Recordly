import { expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(() => true) }));
vi.mock("@/lib/appSettings", () => ({
	loadAppSetting: storage.load,
	saveAppSetting: storage.save,
}));
import { getFeedbackDraft, updateFeedbackDraft } from "./draft";

it("keeps a previous subject and message when loading an older draft", () => {
	storage.load.mockReturnValueOnce({ subject: "Export failed", message: "Stopped early." });
	expect(getFeedbackDraft("legacy-user")).toEqual({
		sentiment: null,
		message: "Export failed\n\nStopped early.",
		files: [],
	});
});

it("persists the selected face with the message and clears both after sending", () => {
	storage.load.mockReturnValueOnce({ sentiment: "loving", message: "Great app!" });
	expect(getFeedbackDraft("sentiment-user").sentiment).toBe("loving");
	updateFeedbackDraft("sentiment-user", { sentiment: "neutral" });
	expect(storage.save).toHaveBeenLastCalledWith("recordly.feedback.draft.v1.sentiment-user", {
		sentiment: "neutral",
		message: "Great app!",
	});
	updateFeedbackDraft("sentiment-user", { sentiment: null, message: "", files: [] });
	expect(getFeedbackDraft("sentiment-user")).toEqual({ sentiment: null, message: "", files: [] });
});

it("restores whitespace-only drafts as empty so the placeholder is visible", () => {
	storage.load.mockReturnValueOnce({ subject: " ", message: " \n\t " });
	expect(getFeedbackDraft("blank-user").message).toBe("");
});

it("preserves formatting in meaningful drafts and ignores a blank legacy subject", () => {
	storage.load.mockReturnValueOnce({ subject: " ", message: "  Steps:\n  1. Export\n" });
	expect(getFeedbackDraft("formatted-user").message).toBe("  Steps:\n  1. Export\n");
});
