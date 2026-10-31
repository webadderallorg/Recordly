import { expect, it } from "vitest";
import { parseSharedRecordingDate } from "./sharedRecordingDate";
it.each([
	undefined,
	"",
	"not a date",
])("normalizes missing or invalid dates (%s) to zero", (value) => {
	expect(parseSharedRecordingDate(value)).toBe(0);
});
it("normalizes SQLite UTC dates and ISO dates to the same timestamp", () => {
	expect(parseSharedRecordingDate("2026-10-03 04:00:00")).toBe(
		Date.parse("2026-10-03T04:00:00Z"),
	);
	expect(parseSharedRecordingDate("2026-10-03T04:00:00Z")).toBe(
		Date.parse("2026-10-03T04:00:00Z"),
	);
});
