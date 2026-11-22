import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { projectLoadError } from "./projectLoadError";

const failures = [
	"EACCES: permission denied",
	"Project video file not found",
	"ENOENT: no such file",
	"Invalid project file format",
	"Failed to load video: decode error",
	"Failed to load video: IO error",
	"Unexpected disk failure",
];

afterEach(() => vi.unstubAllGlobals());

describe("project load error localization", () => {
	it.each(
		SUPPORTED_LOCALES,
	)("localizes actionable errors in %s and preserves diagnostics", (locale) => {
		vi.stubGlobal("window", { localStorage: { getItem: () => "en" } });
		const english = failures.map(projectLoadError);
		vi.stubGlobal("window", { localStorage: { getItem: () => locale } });
		for (const [index, failure] of failures.entries()) {
			const message = projectLoadError(new Error(failure));
			expect(message.details).toBe(failure);
			expect(message.title).not.toContain("notifications.");
			expect(message.description).not.toContain("notifications.");
			if (locale !== "en") {
				expect(message.title).not.toBe(english[index].title);
				expect(message.description).not.toBe(english[index].description);
			}
		}
	});
});
