import { describe, expect, it, vi } from "vitest";
import { getOrCreateProjectThumbnail, peekProjectThumbnail } from "./projectThumbnailCache";

describe("project thumbnail cache", () => {
	it("shares an in-flight render, reuses it on return, and renders a new revision", async () => {
		let finish!: (value: { url: string; duration: number }) => void;
		const create = vi.fn(
			() =>
				new Promise<{ url: string; duration: number }>((resolve) => {
					finish = resolve;
				}),
		);
		const first = getOrCreateProjectThumbnail("project:1", create);
		expect(getOrCreateProjectThumbnail("project:1", create)).toBe(first);
		await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
		finish({ url: "first", duration: 4 });
		await first;
		await expect(getOrCreateProjectThumbnail("project:1", create)).resolves.toEqual({
			url: "first",
			duration: 4,
		});
		expect(create).toHaveBeenCalledOnce();
		expect(peekProjectThumbnail("project:1")?.url).toBe("first");
		await expect(
			getOrCreateProjectThumbnail("project:2", async () => ({ url: "edited", duration: 5 })),
		).resolves.toHaveProperty("url", "edited");
	});

	it("bounds decoder work and allows later renders after an unavailable source", async () => {
		let fail!: (error: Error) => void;
		const first = getOrCreateProjectThumbnail(
			"offline:1",
			() =>
				new Promise((_, reject) => {
					fail = reject;
				}),
		);
		const rejected = expect(first).rejects.toThrow("offline");
		const next = vi.fn(async () => ({ url: "next", duration: 1 }));
		const second = getOrCreateProjectThumbnail("next:1", next);
		await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
		expect(next).not.toHaveBeenCalled();
		fail(new Error("offline"));
		await rejected;
		await second;
		expect(next).toHaveBeenCalledOnce();
		expect(peekProjectThumbnail("offline:1")).toBeUndefined();
	});
});
