import { afterEach, expect, it, vi } from "vitest";
import { challengeEnabled, challengeToken, cloudAuthConfigUrl } from "./cloudAuthProtection";

afterEach(() => vi.unstubAllGlobals());
it("uses cloud configuration without accepting executable or credential-bearing URLs", () => {
	vi.stubGlobal("window", { location: { href: "http://127.0.0.1:5173/" } });
	expect(cloudAuthConfigUrl("https://videos.recordly.dev/api/upload")).toBe(
		"https://videos.recordly.dev/cloud/config",
	);
	expect(cloudAuthConfigUrl("/cloud/config")).toBe("http://127.0.0.1:5173/cloud/config");
	for (const endpoint of [
		"javascript:alert(1)",
		"http://untrusted.example/api/upload",
		"https://user:pass@example.com/",
	])
		expect(() => cloudAuthConfigUrl(endpoint)).toThrow();
});
it("supports existing deployments while rejecting malformed protection flags", () => {
	expect(challengeEnabled({ url: "https://auth.test" })).toBe(false);
	expect(challengeEnabled({ authCaptcha: { enabled: true } })).toBe(true);
	expect(challengeEnabled({ authCaptcha: { enabled: false } })).toBe(false);
	for (const config of [null, {}, { authCaptcha: null }, { authCaptcha: { enabled: "true" } }]) {
		if (config && Object.keys(config).length === 0) continue;
		expect(() => challengeEnabled(config)).toThrow();
	}
});
it("accepts tokens only from the current cloud frame, origin and unpredictable request", () => {
	const source = {} as Window;
	const origin = "https://videos.recordly.dev";
	const requestId = "a".repeat(32);
	const data = {
		type: "recordly-auth-challenge",
		requestId,
		status: "verified",
		token: "one-use-token",
	};
	const event = { source, origin, data } as MessageEvent;
	expect(challengeToken(event, source, origin, requestId)).toBe(data.token);
	for (const bad of [
		{ ...event, origin: "https://videos.recordly.dev.evil.test" },
		{ ...event, source: {} },
		{ ...event, data: { ...data, requestId: "stale-request" } },
		{ ...event, data: { ...data, status: "expired" } },
		{ ...event, data: { ...data, token: "x".repeat(2049) } },
		{ ...event, data: { ...data, token: "" } },
	])
		expect(challengeToken(bad as MessageEvent, source, origin, requestId)).toBeUndefined();
});
