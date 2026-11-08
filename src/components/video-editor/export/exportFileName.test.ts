import { describe, expect, it } from "vitest";
import { getExportFileName } from "./exportFileName";

describe("project export filenames", () => {
	it.each(["mp4", "gif"] as const)("uses the project title for %s exports", (format) => {
		expect(getExportFileName("Product Walkthrough", format)).toBe(
			`Product Walkthrough.${format}`,
		);
		expect(getExportFileName("演示 🎬 v2.1", format)).toBe(`演示 🎬 v2.1.${format}`);
	});
	it.each([
		["  Demo  ", "Demo.mp4"],
		["Demo: take 2/3", "Demo- take 2-3.mp4"],
		["Demo\\take\n2", "Demo-take-2.mp4"],
		["Demo... ", "Demo.mp4"],
		["CON", "_CON.mp4"],
		["nul.notes", "_nul.notes.mp4"],
		["LPT1", "_LPT1.mp4"],
		["Console", "Console.mp4"],
		["", "Untitled Project.mp4"],
		["...", "Untitled Project.mp4"],
		[undefined, "Untitled Project.mp4"],
	])("makes %s safe for the save dialog", (title, expected) => {
		expect(getExportFileName(title, "mp4")).toBe(expected);
	});
});
