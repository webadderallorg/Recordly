import { afterEach, expect, it, vi } from "vitest";
import { checkShareCapacity } from "./shareCapacity";
afterEach(() => vi.unstubAllGlobals());
function mockList(result: unknown) {
	const manage = vi.fn().mockResolvedValue(result);
	vi.stubGlobal("window", { electronAPI: { cloudShareManage: manage } });
	return manage;
}
it("blocks five recordings, including incomplete uploads", async () => {
	mockList({ success: true, videos: Array.from({ length: 5 }, (_, i) => ({ ready: i < 4 })) });
	expect(await checkShareCapacity("https://example.test/api/upload", "token")).toBe(false);
});
it("allows another share after a slot is freed", async () => {
	const manage = mockList({ success: true, videos: Array(4).fill({ ready: true }) });
	expect(await checkShareCapacity("https://example.test/api/upload", "token")).toBe(true);
	expect(manage).toHaveBeenCalledWith({
		endpoint: "https://example.test/api/upload",
		token: "token",
		action: "list",
	});
});
it("fails closed when the server cannot verify capacity", async () => {
	mockList({ success: false, error: "Offline" });
	await expect(checkShareCapacity("https://example.test/api/upload", "token")).rejects.toThrow(
		"Offline",
	);
	mockList({ success: true });
	await expect(checkShareCapacity("https://example.test/api/upload", "token")).rejects.toThrow(
		"Could not check",
	);
});
