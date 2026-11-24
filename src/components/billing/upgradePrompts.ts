import { useCallback, useEffect, useRef } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { useOptionalBilling } from "./BillingProvider";

const EXPORT_UPGRADE_PROMPT_DELAY_MS = 1_500;
const EXPORT_UPGRADE_PROMPT_COOLDOWN_MS = 120_000;
const LAST_EXPORT_UPGRADE_PROMPT_KEY = "recordly.lastExportUpgradePromptAt";
let lastExportUpgradePromptAt = 0;

type BillingSnapshot = {
	loading: boolean;
	signedIn: boolean;
	plan: string | null | undefined;
};

/**
 * Free means signed out, or signed in with a loaded plan that is not Pro.
 * A signed-in plan that failed to load (offline, server error) is unknown, so a
 * paying user is never prompted because their status could not be read.
 */
export function isKnownFreePlan({ loading, signedIn, plan }: BillingSnapshot): boolean {
	if (loading) return false;
	if (!signedIn) return true;
	return plan != null && plan !== "pro";
}

/**
 * Offers Plus when a free user starts a local export, at most once every two minutes.
 */
export function useExportUpgradePrompt() {
	const billing = useOptionalBilling();
	const free = billing
		? isKnownFreePlan({
				loading: billing.loading,
				signedIn: Boolean(billing.user),
				plan: billing.status?.billing.plan,
			})
		: false;
	// The provider recreates these on every render; read the latest at fire time.
	const latest = useRef({ free, billing });
	latest.current = { free, billing };
	const timer = useRef<number | undefined>(undefined);
	const cancelExportUpgradePrompt = useCallback(() => {
		window.clearTimeout(timer.current);
		timer.current = undefined;
	}, []);
	useEffect(() => cancelExportUpgradePrompt, [cancelExportUpgradePrompt]);

	const scheduleExportUpgradePrompt = useCallback(() => {
		cancelExportUpgradePrompt();
		timer.current = window.setTimeout(() => {
			timer.current = undefined;
			const { free, billing } = latest.current;
			if (!free || !billing || billing.pricingOpen) return;
			const now = Date.now();
			const savedAt = loadAppSetting<number>(LAST_EXPORT_UPGRADE_PROMPT_KEY) ?? 0;
			const lastShownAt = Math.max(
				lastExportUpgradePromptAt,
				Number.isFinite(savedAt) ? savedAt : 0,
			);
			if (now - lastShownAt < EXPORT_UPGRADE_PROMPT_COOLDOWN_MS) return;
			lastExportUpgradePromptAt = now;
			saveAppSetting(LAST_EXPORT_UPGRADE_PROMPT_KEY, now);
			billing.openPricing();
		}, EXPORT_UPGRADE_PROMPT_DELAY_MS);
	}, [cancelExportUpgradePrompt]);

	return { scheduleExportUpgradePrompt, cancelExportUpgradePrompt };
}

type UsageSource = {
	status: {
		billing: { plan: string };
		usage: { recordings: number; recordingLimit: number | null };
	} | null;
	fallbackUsage: { recordings: number } | null;
	usagePreview: {
		plan?: string;
		usage?: { recordings: number; recordingLimit: number | null };
	} | null;
};

/**
 * Shares used out of the free allowance, for labels like "Share (2/5)". Null
 * for Pro, unlimited plans, or when usage is not known yet.
 */
export function getFreeShareUsage({
	status,
	fallbackUsage,
	usagePreview,
}: UsageSource): { used: number; limit: number } | null {
	const plan = status?.billing.plan ?? usagePreview?.plan;
	if (plan === "pro") return null;
	const usage = status?.usage ?? (fallbackUsage ? null : usagePreview?.usage);
	const used = usage?.recordings ?? fallbackUsage?.recordings;
	const limit = usage ? usage.recordingLimit : fallbackUsage ? 5 : null;
	if (used === undefined || limit === null || limit === undefined) return null;
	return { used, limit };
}
