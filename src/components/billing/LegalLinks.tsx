import { useScopedT } from "@/contexts/I18nContext";
import { CLOUD_SHARE_ENDPOINT } from "@/components/video-editor/cloud/endpoint";

export function LegalLinks({ consent = false }: { consent?: boolean }) {
	const t = useScopedT("billing");
	let origin = "https://videos.recordly.dev";
	try {
		const endpoint = new URL(CLOUD_SHARE_ENDPOINT);
		if (["https:", "http:"].includes(endpoint.protocol) && !endpoint.username && !endpoint.password)
			origin = endpoint.origin;
	} catch {
		// Account consent remains available when cloud sharing is not configured.
	}
	if (consent) {
		const parts = t(
			"consent",
			"By continuing, you agree to the {{terms}} and acknowledge the {{privacy}}.",
		).split(/(\{\{terms\}\}|\{\{privacy\}\})/);
		return (
			<p className="pricing-legal-consent mx-auto w-full max-w-[552px] text-center text-xs leading-4 text-muted [&_a]:underline [&_a]:underline-offset-[3px]">
				{parts.map((part, index) =>
					part === "{{terms}}" ? (
						<a
							key={index}
							href={`${origin}/terms`}
							target="_blank"
							rel="noopener noreferrer"
						>
							{t("terms", "Terms")}
						</a>
					) : part === "{{privacy}}" ? (
						<a
							key={index}
							href={`${origin}/privacy`}
							target="_blank"
							rel="noopener noreferrer"
						>
							{t("privacyPolicy", "Privacy Policy")}
						</a>
					) : (
						part
					),
				)}
			</p>
		);
	}
	return (
		<nav
			aria-label={t("legalSupport", "Legal and support")}
			className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted"
		>
			{[
				["privacy", t("privacy", "Privacy")],
				["terms", t("terms", "Terms")],
				["billing", t("billingRefunds", "Billing & refunds")],
				["contact", t("contact", "Contact")],
			].map(([path, label]) => (
				<a
					key={path}
					href={`${origin}/${path}`}
					target="_blank"
					rel="noopener noreferrer"
					className="underline-offset-4 hover:underline"
				>
					{label}
				</a>
			))}
		</nav>
	);
}
