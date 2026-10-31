import { describe, expect, it } from "vitest";
import { buildExportMessageStream, type ExportMessage } from "./useExportMessages";

function message(id: string): ExportMessage {
	return { id, text: id, durationSeconds: 6 };
}

describe("buildExportMessageStream", () => {
	it("alternates built-in tips with streamed announcements", () => {
		expect(
			buildExportMessageStream(
				[message("tip-1"), message("tip-2"), message("tip-3")],
				[message("announcement-1"), message("announcement-2")],
			).map(({ id }) => id),
		).toEqual(["tip-1", "announcement-1", "tip-2", "announcement-2", "tip-3"]);
	});

	it("uses only built-in tips when the announcement feed is empty", () => {
		expect(
			buildExportMessageStream([message("tip-1"), message("tip-2")], []).map(({ id }) => id),
		).toEqual(["tip-1", "tip-2"]);
	});
});
