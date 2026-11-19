import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ endpoint: "" }));
vi.mock("@/components/video-editor/cloud/endpoint", () => ({
	get CLOUD_SHARE_ENDPOINT() {
		return state.endpoint;
	},
}));
vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (_key: string, fallback: string) => fallback,
}));
import { LegalLinks } from "./LegalLinks";

describe("legal links remain available independently of cloud configuration", () => {
	it.each([
		"",
		"not a URL",
		"file:///private/policies",
		"javascript:alert(1)",
		"https://user:pass@cloud.test/api/upload",
	])("uses the published policies for invalid endpoint %s", (endpoint) => {
		state.endpoint = endpoint;
		const consent = renderToStaticMarkup(<LegalLinks consent />);
		expect(consent).toContain('href="https://videos.recordly.dev/terms"');
		expect(consent).toContain('href="https://videos.recordly.dev/privacy"');
		const footer = renderToStaticMarkup(<LegalLinks />);
		expect(footer).toContain('href="https://videos.recordly.dev/billing"');
		expect(footer).toContain('href="https://videos.recordly.dev/contact"');
	});
	it.each([
		"https://self-host.test/api/upload",
		"http://localhost:8787/api/upload",
	])("preserves the configured policy origin for %s", (endpoint) => {
		state.endpoint = endpoint;
		const origin = new URL(endpoint).origin;
		expect(renderToStaticMarkup(<LegalLinks consent />)).toContain(`href="${origin}/terms"`);
		expect(renderToStaticMarkup(<LegalLinks />)).toContain(`href="${origin}/billing"`);
	});
});
