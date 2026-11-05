import { expect, it, vi } from "vitest";
import worker from "../src/index.js";

const request = (path) => new Request(`https://share.test${path}`);
const forbiddenBindings = () => new Proxy({}, {
	get(_target, key) {
		if (key === "HOSTED_MODE") return "true";
		throw new Error(`Hosted request accessed public binding: ${String(key)}`);
	},
});

it("rejects hosted requests before touching storage, authentication or external services", async () => {
	for (const path of ["/api/upload", "/api/billing/catalog", "/billing/webhook", "/privacy", "/watch/example"]) {
		const response = await worker.fetch(request(path), forbiddenBindings());
		expect(response.status).toBe(503);
	}
});

it("rejects hosted cron before touching the database or deleting recordings", async () => {
	await expect(worker.scheduled({}, forbiddenBindings())).rejects.toThrow("separate private service");
});

it("does not expose hosted billing endpoints in self-hosted deployments", async () => {
	for (const path of ["/api/billing", "/api/billing/catalog", "/api/billing/webhook", "/billing/return"]) {
		const response = await worker.fetch(request(path), {});
		expect(response.status).toBe(404);
	}
});

it("returns an app-shaped error for unexpected handler failures", async () => {
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
	try {
		const response = await worker.fetch(request("/privacy"), {
			ASSETS: { fetch() { throw new Error("Asset service unavailable"); } },
		});
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Internal error" });
	} finally {
		consoleError.mockRestore();
	}
});
