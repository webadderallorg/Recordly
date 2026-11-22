import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { SettingsSidebarFooter } from "./SettingsSidebarFooter";

const state = vi.hoisted(() => ({ billing: {} as Record<string, unknown> }));
vi.mock("@/components/billing/BillingProvider", () => ({
	useOptionalBilling: () => state.billing,
}));

const user = {
	id: "sidebar-user",
	email: "creator@example.com",
	user_metadata: { full_name: "Alex Creator" },
};
const usage = {
	recordings: 4,
	recordingLimit: 5,
	storageBytes: 4_000_000_000,
	storageLimitBytes: 100_000_000_000,
};
const render = () =>
	renderToStaticMarkup(
		<I18nProvider>
			<SettingsSidebarFooter onAccount={() => undefined} />
		</I18nProvider>,
	);

beforeEach(() => {
	state.billing = {
		user,
		status: { billing: { plan: "free" }, usage },
		catalog: null,
		fallbackUsage: null,
		usagePreview: null,
		loading: false,
		error: null,
		refresh: vi.fn(),
	};
});

describe("settings sidebar account access", () => {
	it.each(["free", "pro"])("keeps %s account access without a duplicate storage card", (plan) => {
		state.billing.status = { billing: { plan }, usage };
		const html = render();
		expect(html).toContain('aria-label="Manage account"');
		expect(html).toContain("Alex Creator");
		expect(html).toContain("creator@example.com");
		expect(html).not.toContain('aria-label="Cloud usage"');
		expect(html).not.toContain('role="progressbar"');
	});

	it("hides quota and account email after sign-out", () => {
		state.billing.user = null;
		const html = render();
		expect(html).not.toContain('aria-label="Cloud usage"');
		expect(html).not.toContain("creator@example.com");
		expect(html).toContain("Local profile");
	});
});
