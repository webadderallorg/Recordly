import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BillingProvider, useBilling } from "@/components/billing/BillingProvider";
import { CloudUsageCard } from "@/components/billing/CloudUsageCard";
import { PricingModal } from "@/components/billing/PricingModal";
import { CloudShareButton } from "@/components/video-editor/cloud/CloudShareButton";
import { CLOUD_SHARE_ENDPOINT } from "@/components/video-editor/cloud/endpoint";
import { notifyShareCapacityChanged } from "@/components/video-editor/cloud/shareCapacity";
import { I18nProvider } from "@/contexts/I18nContext";
import { recordlyAuth } from "@/lib/auth/recordlyAuth";
import "@/index.css";

function Controls() {
	const { refresh, loading, user, status, openPricing } = useBilling();
	const [publishing, setPublishing] = useState(false);
	return (
		<>
			<output data-testid="usage-endpoint">{CLOUD_SHARE_ENDPOINT}</output>
			<output data-testid="verified-plan">{status?.billing.plan ?? "unverified"}</output>
			<output data-testid="verified-checkout">
				{String(status?.billing.checkoutAvailable ?? false)}
			</output>
			<output data-testid="usage-loading">{String(loading)}</output>
			<output data-testid="usage-owner">{user?.id ?? "signed-out"}</output>
			<button onClick={() => void refresh()}>Refresh usage</button>
			<button onClick={openPricing}>Open test pricing</button>
			<button onClick={notifyShareCapacityChanged}>Cloud library changed</button>
			<button onClick={() => setPublishing(true)}>Open test publish</button>
			{publishing && user && (
				<CloudShareButton
					filePath="fixture.mp4"
					projectTitle="Fixture"
					authToken="fixture"
					accountId={user.id}
					inline
				/>
			)}
			<button onClick={() => void recordlyAuth?.auth.signOut()}>Sign out</button>
			<button
				onClick={() => {
					const encode = (value: object) =>
						btoa(JSON.stringify(value))
							.replace(/=/g, "")
							.replace(/\+/g, "-")
							.replace(/\//g, "_");
					const token = `${encode({ alg: "HS256" })}.${encode({ sub: "second-account", exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
					void recordlyAuth?.auth.setSession({
						access_token: token,
						refresh_token: "second-refresh",
					});
				}}
			>
				Switch account
			</button>
		</>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<I18nProvider>
			<BillingProvider>
				<CloudUsageCard />
				<Controls />
				<PricingModal onSignIn={() => undefined} />
			</BillingProvider>
		</I18nProvider>
	</StrictMode>,
);
