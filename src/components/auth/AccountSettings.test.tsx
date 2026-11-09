import type { User } from "@supabase/supabase-js";
import type { FormEvent, ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettings } from "./AccountSettings";

const state = vi.hoisted(() => ({
	slots: [] as { value?: unknown; deps?: readonly unknown[] }[],
	index: 0,
	effects: [] as (() => void)[],
	requestEmail: vi.fn(),
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = state.index++;
		state.slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
		return [
			state.slots[index].value,
			(value: unknown) => {
				state.slots[index].value =
					typeof value === "function" ? value(state.slots[index].value) : value;
			},
		];
	},
	useRef: (initial: unknown) => {
		const index = state.index++;
		state.slots[index] ??= { value: { current: initial } };
		return state.slots[index].value;
	},
	useEffect: (effect: () => void, deps: readonly unknown[]) => {
		const index = state.index++;
		const previous = state.slots[index]?.deps;
		if (
			previous &&
			previous.length === deps.length &&
			previous.every((value, i) => Object.is(value, deps[i]))
		)
			return;
		state.slots[index] = { deps };
		state.effects.push(effect);
	},
}));
vi.mock("@heroui/react", () => ({
	Checkbox: Object.assign(() => null, {
		Content: "checkbox-content",
		Control: "checkbox-control",
		Indicator: "checkbox-indicator",
	}),
	Input: "input",
	Label: "label",
	TextField: "text-field",
}));
vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock("@/components/billing/BillingProvider", () => ({ useBilling: () => ({ status: null }) }));
vi.mock("@/components/billing/AccountPlanCard", () => ({ AccountPlanCard: "plan" }));
vi.mock("@/components/billing/CloudUsageCard", () => ({ CloudUsageCard: "usage" }));
vi.mock("@/components/billing/PlusBadge", () => ({ PlusBadge: "plus" }));
vi.mock("@/components/ui/account-avatar", () => ({
	AccountAvatar: "avatar",
	getAccountProfile: () => ({ name: "Test User" }),
}));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/tabs", () => ({
	Tabs: "tabs",
	TabsContent: "tab-content",
	TabsList: "tab-list",
	TabsTrigger: "tab-trigger",
}));
vi.mock("@/components/feedback/ErrorReportButton", () => ({ ErrorReportButton: "error-report" }));
vi.mock("./RecordlyPasswordForm", () => ({ RecordlyPasswordForm: "password-form" }));
vi.mock("@/lib/auth/recordlyAuth", () => ({
	requestAccountEmailChange: state.requestEmail,
	signOutRecordly: vi.fn(),
	updateAccountName: vi.fn(),
	updateRecordlyPassword: vi.fn(),
	updateMarketingEmailPreference: vi.fn(),
}));
vi.mock("@/lib/auth/signupConsent", () => ({
	MARKETING_CONSENT_LABEL: "Email updates",
	marketingEmailsEnabled: () => false,
}));

function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
	if (Array.isArray(node)) return node.flatMap(nodes);
	if (!node || typeof node !== "object") return [];
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...nodes(element.props?.children)];
}
const user = {
	id: "account-test",
	email: "current@example.com",
	user_metadata: {},
	app_metadata: {},
	identities: [],
} as unknown as User;
function render() {
	state.index = 0;
	const tree = AccountSettings({ user });
	for (const effect of state.effects.splice(0)) effect();
	return nodes(tree);
}
function emailForm() {
	return render().find(
		(node) => node.type === "form" && node.props["aria-label"] === "Email settings",
	)!;
}
function editEmail(email: string) {
	const field = nodes(emailForm()).find((node) => node.props.name === "email")!;
	(field.props.onChange as (email: string) => void)(email);
}
async function submitEmail() {
	const form = emailForm();
	(form.props.onSubmit as (event: FormEvent<HTMLFormElement>) => void)({
		preventDefault: vi.fn(),
		currentTarget: { querySelector: () => null },
	} as unknown as FormEvent<HTMLFormElement>);
	for (let step = 0; step < 8; step++) await Promise.resolve();
	return nodes(emailForm());
}
beforeEach(() => {
	state.slots = [];
	state.index = 0;
	state.effects = [];
	state.requestEmail.mockReset();
});

describe("email update result feedback", () => {
	it.each([
		["New@Example.com", "new@example.com"],
		["  New@Example.com  ", "new@example.com"],
		["new@example.com", "NEW@example.com"],
	])("recognizes an immediately updated canonical address for %s", async (requested, returned) => {
		state.requestEmail.mockResolvedValue({ ...user, email: returned });
		editEmail(requested);
		const result = await submitEmail();
		expect(state.requestEmail).toHaveBeenCalledExactlyOnceWith(requested);
		expect(result.find((node) => node.props.role === "status")?.props.children).toBe(
			"Email address updated.",
		);
	});

	it.each([
		"current@example.com",
		undefined,
	])("retains inbox confirmation when the returned email is %s", async (email) => {
		state.requestEmail.mockResolvedValue({ ...user, email, new_email: "new@example.com" });
		editEmail("New@Example.com");
		const result = await submitEmail();
		expect(result.find((node) => node.props.role === "status")?.props.children).toBe(
			"Check your current and new inboxes for confirmation instructions.",
		);
	});

	it("keeps rejected updates as errors rather than reporting success or confirmation", async () => {
		state.requestEmail.mockRejectedValue(new Error("Request denied"));
		editEmail("new@example.com");
		const result = await submitEmail();
		expect(result.find((node) => node.props.role === "status")).toBeUndefined();
		expect(result.find((node) => node.props.role === "alert")).toBeDefined();
		expect(result.find((node) => node.type === "error-report")?.props.error).toBe(
			"Request denied",
		);
	});

	it.each([
		"invalid@example",
		"invalid",
		"CURRENT@example.com",
	])("keeps the change action disabled for %s", (email) => {
		editEmail(email);
		const button = nodes(emailForm()).find((node) => node.type === "button")!;
		expect(button.props.disabled).toBe(true);
		expect(state.requestEmail).not.toHaveBeenCalled();
	});
});
