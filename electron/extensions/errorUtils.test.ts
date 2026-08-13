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

	it("uses a JSON message when an error field is absent", () => {
		expect(
			formatMarketplaceHttpError({
				status: 409,
				contentType: "application/json",
				body: JSON.stringify({ message: "Extension version already exists" }),
			}),
		).toBe("Marketplace request failed (HTTP 409): Extension version already exists");
	});

	it("prefers a string error when both JSON detail fields are present", () => {
		expect(
			formatMarketplaceHttpError({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({ error: "Primary detail", message: "Secondary detail" }),
			}),
		).toBe("Marketplace request failed (HTTP 400): Primary detail");
	});

	it("hides malformed JSON bodies", () => {
		const body = '{"error":"internal route details"';
		const message = formatMarketplaceHttpError({
			status: 400,
			contentType: "application/json",
			body,
		});

		expect(message).toBe("Marketplace request failed (HTTP 400).");
		expect(message).not.toContain(body);
	});

	it("bounds long JSON details and marks truncation without splitting Unicode", () => {
		const detail = `🚀${"x".repeat(200)}`;
		const message = formatMarketplaceHttpError({
			status: 400,
			contentType: "application/problem+json",
			body: JSON.stringify({ error: detail }),
		});

		expect(message).toBe(`Marketplace request failed (HTTP 400): 🚀${"x".repeat(198)}…`);
		expect(Array.from(message.split(": ")[1])).toHaveLength(200);
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
