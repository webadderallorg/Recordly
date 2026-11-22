import { expect, it, vi } from "vitest";
import {
	EXPORT_LOADING_MESSAGES,
	SENSIBLE_EXPORT_LOADING_MESSAGES,
	SILLY_EXPORT_LOADING_MESSAGES,
	shuffleExportLoadingMessages,
} from "./exportLoadingMessages";

it("keeps loading lines about 80% sensible and 20% silly", () => {
	const sensible = SENSIBLE_EXPORT_LOADING_MESSAGES.flat().length;
	const silly = SILLY_EXPORT_LOADING_MESSAGES.flat().length;
	expect(sensible / (sensible + silly)).toBeCloseTo(0.8, 2);
});

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
