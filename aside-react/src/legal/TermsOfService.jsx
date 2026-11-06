import React from "react";
import { LegalDocument as Legal } from "./LegalDocument";

export const termsTitle = "Terms of service";
export const termsDescription = "The terms for Recordly accounts, cloud sharing and Cloud subscriptions.";

/**
 * @param {{
 *   publication?: { details: typeof import("./config").legalDetails, ready: boolean, version: string },
 *   siteLinks?: { home?: string, blog?: string, features?: string, pricing?: string | null }
 * }} [props]
 */
export default function TermsOfService({ publication, siteLinks } = {}) {
	return (
		<Legal
			title={termsTitle}
			description={termsDescription}
			publication={publication}
			siteLinks={siteLinks}
		>
			<h2>1. Scope and agreement</h2>
			<p>
				These terms govern the hosted Recordly services provided by Recordly. Read them
				together with the <a href="/privacy">privacy policy</a> and{" "}
				<a href="/billing">billing and refund policy</a> before using a hosted account or
				purchasing Cloud. The open-source desktop software remains governed by its applicable
				software licences; these terms do not remove rights granted by those licences.
			</p>
			<p>
				You must have the authority and legal capacity to agree to these terms. If you need
				a parent’s or guardian’s permission under applicable law, involve them before using
				a hosted account. A paid subscription must be purchased by someone authorised to
				enter the payment agreement. If you use Recordly for an organisation, you must be
				authorised to act for it.
			</p>
			<h2>2. Your account</h2>
			<p>
				Provide accurate account information, protect your sign-in methods and tell us if
				your account appears compromised. Account features and paid access are linked to
				your verified Recordly account, not a particular installation or a matching checkout
				email address. Do not share another person’s credentials, impersonate someone or try
				to access another account’s private library.
			</p>
			<h2>3. Your recordings and permissions</h2>
			<p>
				You retain ownership of the content you create or upload. You give the operator and
				its service providers the limited permission needed to store, process, display and
				deliver content through the features you use, including generating thumbnails,
				serving sharing links and maintaining permitted recovery copies. We do not acquire
				ownership of your recordings.
			</p>
			<p>
				You are responsible for having the rights and permissions required to record
				screens, people, voices, meetings, copyrighted works and personal or confidential
				information. Recording consent requirements vary by location. Upload only content
				you are authorised to share.
			</p>
			<h2>4. Sharing and local copies</h2>
			<p>
				Anyone who obtains an unprotected sharing link may be able to watch and redistribute
				it. Password protection adds an access check but cannot prevent an authorised viewer
				from copying content. Do not treat a public link as confidential storage. The
				service hosts published media; it is not a backup service for editable Recordly
				projects. Keep your own copies of important work.
			</p>
			<h2>5. Free and Cloud services</h2>
			<p>
				The desktop recording and editing features remain available under the software’s
				licence. Optional hosted services have the limits displayed in the app and at
				checkout. At launch, Free allows five stored cloud recordings of up to 1 GB each,
				normally expiring after 7 days. Cloud includes unlimited cloud storage and playback
				bandwidth, with up to 10 GB per recording. Cloud allows 200 new uploads per rolling seven days, including admitted uploads later
				canceled or deleted. Daily upload-capacity and abuse protections also apply. GB means one billion bytes.
				Reserved and incomplete uploads may count toward capacity.
			</p>
			<p>
				Cloud recordings have no scheduled expiry while Cloud is active. A verified upgrade also
				protects eligible recordings still stored at the time of upgrade. When Cloud ends, those
				recordings expire after a seven-day grace period. Save a copy or renew before that
				deadline. Upgrading cannot recover expired or deleted files. New uploads after Cloud
				ends follow the Free limits; stored recordings continue to count toward applicable
				limits.
			</p>
			<p>
				“No expiry” applies only while Cloud is active. Cloud recordings expire seven days after
				Cloud ends. It does not prevent deletion you request, lawful removal or removal
				necessary to address serious abuse. It is not a guarantee of uninterrupted service
				or a separate disaster-recovery copy.
			</p>
			<h2>6. Prices, renewals and cancellation</h2>
			<p>
				Cloud is a recurring subscription. Current pricing and any promotional offers appear in Recordly. Checkout
				displays the amount, currency, interval and any applicable taxes before you pay.
				Your payment provider or bank may apply currency-conversion fees.
			</p>
			<p>
				Your subscription renews automatically at its stated interval until cancelled. Use{" "}
				<strong>Manage subscription</strong> in Recordly to access Stripe’s billing portal.
				A normal cancellation stops renewal and keeps paid access until the end of the
				current paid period. Uninstalling the app, signing out or deleting a recording does
				not cancel billing. See <a href="/billing">billing and refunds</a> for further
				details.
			</p>
			<p>
				We will give advance notice of a material price or plan change before it applies to
				a renewal, with the opportunity to cancel. We will not charge a different price for
				an already-paid period without your agreement. Cloud recording retention follows the Free and Cloud rules
				above.
			</p>
			<h2>7. Acceptable use</h2>
			<p>
				You are responsible for the content you upload, store or share, including its
				legality and the rights, permissions and consents needed to use it. Recordly provides
				hosting and sharing tools and does not endorse user content. Except to the extent
				required by applicable law, we do not assume responsibility for user content or
				undertake a general obligation to monitor, review or approve it. Hosting content
				does not mean we have reviewed or approved it.
			</p>
			<p>
				Do not use the service for unlawful content, child sexual abuse material, threats,
				harassment, infringement, non-consensual intimate material, malware or disclosure of
				information you are not entitled to publish. Do not evade storage limits or security
				controls, conduct unauthorised testing, interfere with other users, automate abusive
				traffic or resell access without permission.
			</p>
			<p>
				We may restrict access or remove content where required by law or reasonably
				necessary to enforce these terms, protect people or prevent serious abuse. This
				does not create a commitment to investigate every report or review every recording.
				Where lawful and practical, we will explain the reason for a restriction or removal
				and offer a way to challenge an error. Nothing in this section excludes obligations
				or liability that cannot lawfully be excluded, or removes statutory refund rights.
			</p>
			<h2>8. Payments that fail or are disputed</h2>
			<p>
				Paid upload privileges depend on a valid, paid subscription. Failed payments,
				cancellation taking effect, refunds or disputes may suspend those privileges while
				billing is resolved. If Cloud access ends, existing cloud recordings receive the seven-day grace period
				described above. Contact support if the account or
				billing status is wrong; do not start multiple subscriptions to bypass a
				restriction.
			</p>
			<h2>9. Availability, changes and closure</h2>
			<p>
				We aim to operate the service reliably, but outages, maintenance and
				service-provider failures can occur. We may make reasonable service changes. If we
				plan to discontinue hosted storage, we will give reasonable advance notice and an
				opportunity to export available media where practical, and address prepaid services
				and refunds in accordance with applicable law.
			</p>
			<p>
				Account closure, data deletion and subscription cancellation are different actions.
				Contact support for help closing an account and removing associated hosted
				information. We may retain records required by law or necessary to resolve an
				outstanding matter as explained in the privacy policy.
			</p>
			<h2>10. Consumer rights and responsibility</h2>
			<p>
				Nothing in these terms excludes, restricts or modifies a guarantee, right or remedy
				that cannot lawfully be excluded, including rights under the Australian Consumer Law
				where it applies. You may be entitled to a repair, replacement, refund, cancellation
				or compensation when a service fails a statutory guarantee.
			</p>
			<p>
				Subject to those rights, we do not promise that the service will be suitable for
				every purpose or free of interruptions. Each party remains responsible for its
				conduct as required by applicable law. These terms do not impose an unlimited
				indemnity on individual users or require you to waive non-excludable rights.
			</p>
			<h2>11. Concerns and updates</h2>
			<p>
				Contact us using the details below about billing, a privacy request, an access
				restriction, illegal content or another dispute. Tell us enough to identify the
				account or link without sending passwords or full payment details. Applicable law
				determines any rights to contact a regulator or seek a legal remedy; these terms do
				not remove them.
			</p>
			<p>
				Material changes will be published with an updated effective date and any notice or
				acceptance required by law. Changes will not retroactively remove an accrued
				consumer right or a prepaid period of Cloud access.
			</p>
		</Legal>
	);
}
