import { describe, expect, it } from "vitest";
import { formatLogTs } from "./log";

describe("formatLogTs (main)", () => {
	it("formats a wall-clock time as a zero-padded HH:MM:SS.mmm prefix", () => {
		const date = new Date(2026, 0, 15, 9, 5, 3, 7);
		expect(formatLogTs(date)).toBe("09:05:03.007");
	});

	it("keeps hours/minutes/seconds/millis within their two/three-digit widths", () => {
		const date = new Date(2026, 0, 15, 23, 59, 59, 999);
		expect(formatLogTs(date)).toBe("23:59:59.999");
	});

	it("defaults to the current wall-clock time", () => {
		const now = new Date();
		const formatted = formatLogTs();
		const hours = String(now.getHours()).padStart(2, "0");
		const minutes = String(now.getMinutes()).padStart(2, "0");
		expect(formatted.startsWith(`${hours}:${minutes}:`)).toBe(true);
	});
});
