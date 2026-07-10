import { describe, expect, it } from "vitest";

import { formatMarketplaceHttpError } from "./errorUtils";

describe("formatMarketplaceHttpError", () => {
	it("hides upstream HTML when the marketplace is unavailable", () => {
		const html = "<!DOCTYPE html><html><body>SSL handshake failed</body></html>";

		const message = formatMarketplaceHttpError({
			status: 525,
			contentType: "text/html; charset=UTF-8",
			body: html,
		});

		expect(message).toBe(
			"Marketplace is temporarily unavailable (HTTP 525). Please try again later.",
		);
		expect(message).not.toContain(html);
	});

	it("keeps a short JSON error for client-side request failures", () => {
		expect(
			formatMarketplaceHttpError({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({ error: "Invalid search query" }),
			}),
		).toBe("Marketplace request failed (HTTP 400): Invalid search query");
	});

	it("does not expose non-JSON response bodies", () => {
		expect(
			formatMarketplaceHttpError({
				status: 404,
				contentType: "text/plain",
				body: "internal route details",
			}),
		).toBe("Marketplace request failed (HTTP 404).");
	});
});
