import { expect, it, vi } from "vitest";
import { handleRequest } from "../src/router.js";

it("serves public policies without a database, login or billing provider", async () => {
	const fetch = vi.fn(async () => new Response("Policy"));
	for (const path of ["/privacy", "/terms", "/billing", "/contact", "/privacy/", "/billing/"]) {
		const response = await handleRequest(new Request(`https://share.test${path}`), {
			ASSETS: { fetch },
		});
		expect(await response.text()).toBe("Policy");
	}
	expect(fetch).toHaveBeenCalledTimes(6);
});
