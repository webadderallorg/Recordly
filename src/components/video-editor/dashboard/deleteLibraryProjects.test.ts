import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
	links: new Map<string, { url: string; accountId: string }>(),
	manage: vi.fn(),
}));
vi.mock("../cloud/endpoint", () => ({ CLOUD_SHARE_ENDPOINT: "https://recordly.test/api/upload" }));
vi.mock("../cloud/projectShareLinks", () => ({
	getProjectShareLink: (p: string) => state.links.get(p)?.url,
	getProjectShare: (p: string, id: string) =>
		!state.links.get(p)?.accountId || state.links.get(p)?.accountId === id
			? state.links.get(p)
			: null,
	removeProjectShareLinksByUrl: (url: string) => {
		for (const [p, s] of state.links) if (s.url === url) state.links.delete(p);
	},
}));
import { deleteLibraryProjectsWithMedia } from "./deleteLibraryProjects";
beforeEach(() => {
	state.links.clear();
	state.manage.mockReset();
	vi.stubGlobal("window", { electronAPI: { cloudShareManage: state.manage } });
});
afterEach(() => vi.unstubAllGlobals());
const share = (p: string, url = "https://recordly.test/s/abc") =>
	state.links.set(p, { url, accountId: "owner" });
const run = (removeLocal = vi.fn(async (p: string[]) => p), extra = {}) =>
	deleteLibraryProjectsWithMedia({
		paths: ["a"],
		allProjectPaths: ["a", "b"],
		accountId: "owner",
		token: "token",
		removeLocal,
		...extra,
	});
it("keeps local project and media when remote deletion fails", async () => {
	share("a");
	state.manage.mockResolvedValue({ success: false });
	const local = vi.fn();
	const result = await run(local);
	expect(local).not.toHaveBeenCalled();
	expect(result.deleted).toEqual([]);
	expect(result.errors).toHaveLength(1);
	expect(state.links.has("a")).toBe(true);
});
it("deletes remote first, then enables managed source removal after success", async () => {
	share("a");
	const order: string[] = [];
	state.manage.mockImplementation(async () => {
		order.push("remote");
		return { success: true };
	});
	const local = vi.fn(async (p: string[]) => {
		order.push("local");
		return p;
	});
	expect((await run(local)).deleted).toEqual(["a"]);
	expect(order).toEqual(["remote", "local"]);
	expect(local).toHaveBeenCalledWith(["a"], { includeSources: true });
});
it("preserves a cloud video used by an unselected project", async () => {
	share("a");
	share("b");
	expect((await run()).deleted).toEqual(["a"]);
	expect(state.manage).not.toHaveBeenCalled();
	expect(state.links.has("b")).toBe(true);
});
it("never sends credentials for foreign server or account and blocks local deletion", async () => {
	for (const extra of [{ accountId: "foreign" }, {}]) {
		share("a", extra.accountId ? undefined : "https://foreign.test/s/abc");
		const local = vi.fn();
		expect((await run(local, extra)).errors).toHaveLength(1);
		expect(local).not.toHaveBeenCalled();
		expect(state.manage).not.toHaveBeenCalled();
	}
});
it("preserves failed selected cloud projects while deleting independent eligible ones", async () => {
	share("a");
	state.manage.mockResolvedValue({ success: false });
	const local = vi.fn(async (p: string[]) => p);
	expect((await run(local, { paths: ["a", "b"] })).deleted).toEqual(["b"]);
	expect(local).toHaveBeenCalledWith(["b"], { includeSources: true });
});

it("treats a verified absent remote copy as complete only for an explicit matching owner", async () => {
	share("a");
	state.manage.mockResolvedValue({ success: false, httpStatus: 404, resourceMissing: true });
	expect((await run()).deleted).toEqual(["a"]);
	share("a");
	state.links.set("a", { url: "https://recordly.test/s/abc", accountId: "" });
	state.manage.mockClear();
	const local = vi.fn();
	expect((await run(local)).errors).toHaveLength(1);
	expect(local).not.toHaveBeenCalled();
	expect(state.manage).toHaveBeenCalledOnce();
});
it.each([
	401,
	403,
	429,
	500,
	503,
	undefined,
])("retains local media for HTTP %s or an unknown failure", async (httpStatus) => {
	share("a");
	state.manage.mockResolvedValue({ success: false, httpStatus });
	const local = vi.fn();
	expect((await run(local)).deleted).toEqual([]);
	expect(local).not.toHaveBeenCalled();
});

it("allows a legacy link to delete only after a successful authenticated remote deletion", async () => {
	state.links.set("a", { url: "https://recordly.test/s/abc", accountId: "" });
	state.manage.mockResolvedValue({ success: true });
	expect((await run()).deleted).toEqual(["a"]);
	expect(state.manage).toHaveBeenCalledOnce();
});

it("keeps local files when a generic route/edge404 does not confirm a missing video", async () => {
	share("a");
	state.manage.mockResolvedValue({ success: false, httpStatus: 404, resourceMissing: false });
	const local = vi.fn();
	expect((await run(local)).deleted).toEqual([]);
	expect(local).not.toHaveBeenCalled();
});
