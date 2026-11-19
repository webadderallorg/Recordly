import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock("./recordlyAuth", () => ({ recordlyAuth: { auth } }));
beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
});
const session = (token: string, id = "alice") => ({ access_token: token, user: { id } });
it("shares one refresh for a rejected token and returns its replacement", async () => {
	const { recoverBillingSession } = await import("./recoverBillingSession");
	auth.getSession.mockResolvedValue({ data: { session: session("old") } });
	auth.refreshSession.mockResolvedValue({ data: { session: session("new") } });
	const first = recoverBillingSession("old", "alice");
	expect(recoverBillingSession("old", "alice")).toBe(first);
	expect(await first).toBe("new");
	expect(auth.refreshSession).toHaveBeenCalledTimes(1);
});
it("uses an already renewed token without refreshing it again", async () => {
	const { recoverBillingSession } = await import("./recoverBillingSession");
	auth.getSession.mockResolvedValue({ data: { session: session("new") } });
	expect(await recoverBillingSession("old", "alice")).toBe("new");
	expect(auth.refreshSession).not.toHaveBeenCalled();
});
it("never uses another account's session or refreshes it", async () => {
	const { recoverBillingSession } = await import("./recoverBillingSession");
	auth.getSession.mockResolvedValue({ data: { session: session("bob-token", "bob") } });
	expect(await recoverBillingSession("old", "alice")).toBeUndefined();
	expect(auth.refreshSession).not.toHaveBeenCalled();
});
it("allows recovery after a temporary connection failure", async () => {
	const { recoverBillingSession } = await import("./recoverBillingSession");
	auth.getSession.mockResolvedValue({ data: { session: session("old") } });
	auth.refreshSession
		.mockRejectedValueOnce(Error("Offline"))
		.mockResolvedValue({ data: { session: session("new") } });
	await expect(recoverBillingSession("old", "alice")).rejects.toThrow("Check your connection");
	expect(await recoverBillingSession("old", "alice")).toBe("new");
	expect(auth.refreshSession).toHaveBeenCalledTimes(2);
});

it("treats an invalid refresh token as requiring sign-in", async () => {
	const { recoverBillingSession } = await import("./recoverBillingSession");
	auth.getSession.mockResolvedValue({ data: { session: session("old") } });
	auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 400 } });
	expect(await recoverBillingSession("old", "alice")).toBeUndefined();
});

it("never returns a renewed session belonging to another account", async () => {
	const { recoverBillingSession } = await import("./recoverBillingSession");
	auth.getSession.mockResolvedValue({ data: { session: session("old") } });
	auth.refreshSession.mockResolvedValue({ data: { session: session("bob-token", "bob") } });
	expect(await recoverBillingSession("old", "alice")).toBeUndefined();
});
