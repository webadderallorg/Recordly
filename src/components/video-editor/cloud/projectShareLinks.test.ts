import { afterEach, expect, it, vi } from "vitest";
import {
	getProjectShareLink,
	moveProjectShareLink,
	removeProjectShareLinks,
	saveProjectShareLink,
} from "./projectShareLinks";
afterEach(() => vi.unstubAllGlobals());
it("retains share links across renames and clears obsolete paths", () => {
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) || null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	saveProjectShareLink("old", "https://example.com/share");
	moveProjectShareLink("old", "new");
	expect(getProjectShareLink("new")).toBe("https://example.com/share");
	expect(getProjectShareLink("old")).toBeUndefined();
	removeProjectShareLinks(["new"]);
	expect(getProjectShareLink("new")).toBeUndefined();
});
