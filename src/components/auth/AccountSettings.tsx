import { RecordlyPasswordForm } from "./RecordlyPasswordForm";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Checkbox, Input, Label, TextField } from "@heroui/react";
import type { User } from "@supabase/supabase-js";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useBilling } from "@/components/billing/BillingProvider";
import { AccountPlanCard } from "@/components/billing/AccountPlanCard";
import { CloudUsageCard } from "@/components/billing/CloudUsageCard";
import { PlusBadge } from "@/components/billing/PlusBadge";
import { AccountAvatar, getAccountProfile } from "@/components/ui/account-avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/contexts/I18nContext";
import {
	requestAccountEmailChange,
	signOutRecordly,
	updateAccountName,
	updateRecordlyPassword,
	updateMarketingEmailPreference,
} from "@/lib/auth/recordlyAuth";
import { MARKETING_CONSENT_LABEL, marketingEmailsEnabled } from "@/lib/auth/signupConsent";
import "./AccountSettings.css";

type AccountAction = "name" | "email" | "marketing" | "signout";
type ActionFeedback = { message?: string; error?: string; details?: string };

const providerNames: Record<string, string> = {
	google: "Google",
	azure: "Microsoft",
	github: "GitHub",
	apple: "Apple",
};

function profileName(user: User | null): string {
	const name = user?.user_metadata?.full_name ?? user?.user_metadata?.name;
	return typeof name === "string" ? name : "";
}

export function AccountSettings({
	user,
	layout = "page",
}: {
	user: User | null;
	layout?: "page" | "modal";
}) {
	const [section, setSection] = useState("profile");
	const { t } = useI18n();
	const { status } = useBilling();
	const [name, setName] = useState(() => profileName(user));
	const [email, setEmail] = useState(user?.email ?? "");
	const savedMarketingEmails = marketingEmailsEnabled(user);
	const [marketingEmails, setMarketingEmails] = useState(savedMarketingEmails);
	useEffect(() => setMarketingEmails(savedMarketingEmails), [savedMarketingEmails]);
	const [busy, setBusy] = useState<AccountAction>();
	const [feedback, setFeedback] = useState<Partial<Record<AccountAction, ActionFeedback>>>({});
	const submittedForm = useRef<HTMLFormElement | null>(null);
	useEffect(() => {
		if (busy || !submittedForm.current) return;
		const form = submittedForm.current;
		submittedForm.current = null;
		// Disabling a submit button can leave focus on the document body.
		if (document.activeElement === document.body)
			form.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
	}, [busy]);
	const savedName = profileName(user);
	useEffect(() => setName(savedName), [savedName]);
	useEffect(() => setEmail(user?.email ?? ""), [user?.email]);

	const run = async (action: AccountAction, work: () => Promise<string | void>) => {
		if (busy) return;
		setBusy(action);
		setFeedback((current) => ({ ...current, [action]: undefined }));
		try {
			const message = await work();
			if (message) setFeedback((current) => ({ ...current, [action]: { message } }));
		} catch (error) {
			setFeedback((current) => ({
				...current,
				[action]: {
					error: t(
						action === "signout" ? "support.signOutFailure" : "support.accountFailure",
					),
					details: error instanceof Error ? error.message : String(error),
				},
			}));
		} finally {
			setBusy(undefined);
		}
	};
	const submitName = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		submittedForm.current = event.currentTarget;
		void run("name", async () => {
			await updateAccountName(name);
			return t("settings.account.profileSaved", "Profile saved.");
		});
	};
	const submitEmail = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		submittedForm.current = event.currentTarget;
		void run("email", async () => {
			const updated = await requestAccountEmailChange(email);
			return updated.email?.toLowerCase() === email.trim().toLowerCase()
				? t("settings.account.emailUpdated", "Email address updated.")
				: t(
						"settings.account.confirmInboxes",
						"Check your current and new inboxes for confirmation instructions.",
					);
		});
	};

	const actionFeedback = (action: AccountAction) => {
		const result = feedback[action];
		if (!result) return null;
		return result.error ? (
			<div role="alert" className="account-settings-feedback text-danger">
				{result.error} <ErrorReportButton error={result.details ?? result.error} />
				{result.details && (
					<details>
						<summary>{t("support.diagnostics")}</summary>
						{result.details}
					</details>
				)}
			</div>
		) : (
			<p role="status" className="account-settings-feedback text-success">
				{result.message}
			</p>
		);
	};

	if (!user)
		return (
			<p className="text-sm text-muted">
				{t("settings.account.signIn", "Sign in to manage your account.")}
			</p>
		);
	const profile = getAccountProfile(user);
	const providers = [
		...new Set([
			...(user.identities?.map((identity) => identity.provider) ?? []),
			...(Array.isArray(user.app_metadata.providers) ? user.app_metadata.providers : []),
		]),
	].filter((provider): provider is string => typeof provider === "string");
	const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
	const profileSection = (
		<form
			onSubmit={submitName}
			className="account-settings-section account-settings-form space-y-3"
			aria-label={t("settings.account.profileSettings", "Profile settings")}
		>
			<h3>{t("settings.account.profileHeading", "Profile")}</h3>
			<TextField
				name="displayName"
				value={name}
				onChange={setName}
				isRequired
				isDisabled={Boolean(busy)}
			>
				<Label>{t("settings.account.displayName", "Display name")}</Label>
				<Input variant="secondary" maxLength={80} autoComplete="name" className="w-full" />
			</TextField>
			<Button
				type="submit"
				variant="secondary"
				size="sm"
				disabled={Boolean(busy) || !name.trim() || name.trim() === profileName(user)}
			>
				{busy === "name"
					? t("settings.account.saving", "Saving…")
					: t("settings.account.saveProfile", "Save profile")}
			</Button>
			{actionFeedback("name")}
		</form>
	);
	const emailSection = (
		<form
			onSubmit={submitEmail}
			className="account-settings-section account-settings-form space-y-3"
			aria-label={t("settings.account.emailSettings", "Email settings")}
		>
			<h3>{t("settings.account.signInEmailHeading", "Sign-in email")}</h3>
			<TextField
				name="email"
				type="email"
				value={email}
				onChange={setEmail}
				isRequired
				isDisabled={Boolean(busy)}
			>
				<Label>{t("settings.account.email", "Email address")}</Label>
				<Input variant="secondary" autoComplete="email" className="w-full" />
			</TextField>
			<p className="text-xs leading-relaxed text-muted">
				{t(
					"settings.account.confirmEmail",
					"Confirm your new address by email before using it to sign in.",
				)}
			</p>
			{user.new_email && user.new_email !== user.email && (
				<p role="status" className="account-settings-pending break-words text-xs">
					{t(
						"settings.account.awaitingConfirmation",
						"Awaiting confirmation: {{email}}",
						{ email: user.new_email },
					)}
				</p>
			)}
			<Button
				type="submit"
				variant="secondary"
				size="sm"
				disabled={
					Boolean(busy) ||
					!validEmail ||
					email.trim().toLowerCase() === user.email?.toLowerCase() ||
					email.trim() === user.new_email
				}
			>
				{busy === "email"
					? t("settings.account.sending", "Sending…")
					: t("settings.account.changeEmail", "Change email")}
			</Button>
			{actionFeedback("email")}
		</form>
	);
	const passwordSection = (
		<section className="account-settings-section account-settings-password">
			<RecordlyPasswordForm
				onSave={updateRecordlyPassword}
				labels={{
					passwordHeading: t("settings.account.passwordHeading"),
					passwordDescription: t("settings.account.passwordDescription"),
					newPassword: t("settings.account.newPassword"),
					confirmPassword: t("settings.account.confirmPassword"),
					savePassword: t("settings.account.savePassword"),
					passwordSaved: t("settings.account.passwordSaved"),
					passwordMinimum: t("settings.account.passwordMinimum"),
					passwordMismatch: t("settings.account.passwordMismatch"),
					savingPassword: t("settings.account.savingPassword"),
					failure: t("support.accountFailure"),
				}}
			/>
		</section>
	);
	const preferencesSection = (
		<section
			className="account-settings-section space-y-3"
			aria-label={t("settings.account.emailPreferences", "Email preferences")}
		>
			<h3>{t("settings.account.emailUpdates", "Email updates")}</h3>
			<Checkbox
				variant="secondary"
				isSelected={marketingEmails}
				isDisabled={Boolean(busy)}
				onChange={(enabled) => {
					void run("marketing", async () => {
						await updateMarketingEmailPreference(enabled);
						setMarketingEmails(enabled);
						return t(
							"settings.account.emailPreferencesSaved",
							"Email preferences saved.",
						);
					});
				}}
			>
				<Checkbox.Content>
					<Checkbox.Control>
						<Checkbox.Indicator />
					</Checkbox.Control>
					<Label className="text-xs leading-relaxed">
						{t("settings.account.marketingConsent", MARKETING_CONSENT_LABEL)}
					</Label>
				</Checkbox.Content>
			</Checkbox>
			{actionFeedback("marketing")}
		</section>
	);
	const cloudSection = (
		<section
			className="account-settings-section account-settings-cloud"
			aria-label={t("billing.accountPlan", "Plan & billing")}
		>
			<AccountPlanCard />
			<CloudUsageCard showUpgrade={false} />
		</section>
	);
	const providersSection = (
		<section
			className="account-settings-section space-y-3"
			aria-label={t("settings.account.signInMethods", "Sign-in methods")}
		>
			<h3>{t("settings.account.signInMethods", "Sign-in methods")}</h3>
			<p className="text-xs text-muted">
				{t(
					"settings.account.signInMethodsDescription",
					"Methods connected to your account.",
				)}
			</p>
			<ul
				className="flex flex-wrap gap-2"
				aria-label={t("settings.account.connectedMethods", "Connected sign-in methods")}
			>
				{providers.map((provider) => (
					<li
						key={provider}
						className="rounded-lg bg-surface-secondary px-3 py-2 text-xs"
					>
						{provider === "email"
							? t("settings.account.emailCode", "Email code")
							: (providerNames[provider] ?? provider)}
					</li>
				))}
			</ul>
		</section>
	);
	const sessionsSection = (
		<section
			className="account-settings-section space-y-3"
			aria-label={t("settings.account.sessionsHeading", "Account sessions")}
		>
			<h3>{t("settings.account.sessionsHeading", "Account sessions")}</h3>
			<p className="text-xs leading-relaxed text-muted">
				{t(
					"settings.account.signOutDescription",
					"Sign out of Recordly on all devices. Local projects stay on this computer.",
				)}
			</p>
			<Button
				variant="destructive-soft"
				size="sm"
				disabled={Boolean(busy)}
				onClick={() => void run("signout", signOutRecordly)}
			>
				{busy === "signout"
					? t("editor.cloud.signingOut", "Signing out…")
					: t("settings.account.signOutAllDevices", "Sign out of all devices")}
			</Button>
			{actionFeedback("signout")}
		</section>
	);
	return (
		<div
			className={
				layout === "modal" ? "account-settings account-settings--modal" : "account-settings"
			}
		>
			<div className="account-settings-identity flex min-w-0 items-center gap-3">
				<AccountAvatar user={user} className="size-12" />
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2">
						<p className="truncate text-sm font-semibold">{profile.name}</p>
						{status?.billing.plan === "pro" && <PlusBadge />}
					</div>
					<p className="break-all text-xs text-muted">{user.email}</p>
				</div>
			</div>
			{layout === "modal" ? (
				<Tabs
					value={section}
					onValueChange={setSection}
					variant="secondary"
					className="account-settings-tabs"
				>
					<TabsList aria-label={t("settings.account.settingsLabel", "Account settings")}>
						<TabsTrigger value="profile">
							{t("settings.account.profileHeading", "Profile")}
						</TabsTrigger>
						<TabsTrigger value="signin">
							{t("settings.account.signInMethods", "Sign-in methods")}
						</TabsTrigger>
						<TabsTrigger value="cloud">
							{t("billing.accountPlan", "Plan & billing")}
						</TabsTrigger>
					</TabsList>
					<TabsContent value={section} className="account-settings-tab-panel">
						<div
							hidden={section !== "profile"}
							className="account-settings-tab-content"
						>
							{profileSection}
							{preferencesSection}
						</div>
						<div hidden={section !== "signin"} className="account-settings-tab-content">
							{emailSection}
							{passwordSection}
							{providersSection}
							{sessionsSection}
						</div>
						<div hidden={section !== "cloud"} className="account-settings-tab-content">
							{cloudSection}
						</div>
					</TabsContent>
				</Tabs>
			) : (
				<>
					{profileSection}
					{emailSection}
					{passwordSection}
					{preferencesSection}
					{cloudSection}
					{providersSection}
					{sessionsSection}
				</>
			)}
		</div>
	);
}
