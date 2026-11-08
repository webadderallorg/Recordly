export const LEGAL_VERSION = "2026-10-21";
export const legalDetails = {
	email: import.meta.env.PUBLIC_LEGAL_SUPPORT_EMAIL?.trim() || "support@recordly.dev",
	locations:
		import.meta.env.PUBLIC_LEGAL_PROCESSING_LOCATIONS?.trim() ||
		"The Supabase project used for accounts and feedback is hosted in US East (Northern Virginia, United States). Cloudflare media storage and sharing metadata are configured with Oceania placement hints; these hints do not guarantee Australia-only storage. Cloudflare delivers content through its global network. Stripe, Google and other service providers may process information in additional countries under their service arrangements.",
	effectiveDate: import.meta.env.PUBLIC_LEGAL_EFFECTIVE_DATE?.trim() || "",
	approved: import.meta.env.PUBLIC_LEGAL_APPROVED === "true",
};
const values = [legalDetails.email, legalDetails.locations, legalDetails.effectiveDate];
export const legalReady = Boolean(
	legalDetails.approved &&
		legalDetails.email &&
		legalDetails.locations &&
		legalDetails.effectiveDate &&
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(legalDetails.email) &&
		/^\d{4}-\d{2}-\d{2}$/.test(legalDetails.effectiveDate) &&
		!values.some((value) =>
			/(?:example\.(?:com|org)|\[|\]|TODO|TBD|pending|placeholder)/i.test(value),
		),
);
