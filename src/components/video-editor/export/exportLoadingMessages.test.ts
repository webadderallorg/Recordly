import { expect, it, vi } from "vitest";
import { EXPORT_LOADING_MESSAGES, shuffleExportLoadingMessages } from "./exportLoadingMessages";

it("shuffles the loading lines without splitting the updater sequence", () => {
	const random = vi.spyOn(Math, "random").mockReturnValue(0);
	try {
		const order = shuffleExportLoadingMessages(EXPORT_LOADING_MESSAGES);
		const original = EXPORT_LOADING_MESSAGES.flat();
		const updater = order.indexOf("Updating Updater...");
		expect(order).not.toEqual(original);
		expect([...order].sort()).toEqual([...original].sort());
		expect(order.slice(updater, updater + 3)).toEqual([
			"Updating Updater...",
			"Downloading Downloader...",
			"Debugging Debugger...",
		]);
	} finally {
		random.mockRestore();
	}
});
