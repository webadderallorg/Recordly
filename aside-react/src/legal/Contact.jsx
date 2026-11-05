import React from "react";
import { legalDetails } from "./config";
import { LegalDocument as Legal } from "./LegalDocument";

export default function Contact() {
	return (
		<Legal
			title="Contact Recordly"
			description="Help with your account, subscription, recordings or privacy."
		>
			<h2>Support and privacy requests</h2>
			{legalDetails.email ? (
				<p>
					Email <a href={`mailto:${legalDetails.email}`}>{legalDetails.email}</a>. Include
					the account email and a short description so we can route your request.
				</p>
			) : (
				<p>
					The public support address is being verified. For now, use the in-app feedback
					form while signed in. Do not post private account or billing information in a
					public GitHub issue.
				</p>
			)}
			<p>
				For a billing question, include the invoice reference and date. For a problem with a
				shared recording, include its link and explain what happened. To report illegal or
				harmful content, identify the specific recording and concern. For an access,
				correction or deletion request, describe the information or account involved.
			</p>
			<p>
				Never send passwords, sign-in links, API keys, full card details or recordings you
				do not need us to inspect. We may ask you to verify account ownership before
				changing account data, disclosing information or handling a payment request.
			</p>
			<h2>Technical feedback</h2>
			<p>
				The desktop app’s feedback form accepts a description, attachments and relevant
				diagnostic logs. Review what you attach, especially if your screen contains private
				information. Public source-code issues belong in the{" "}
				<a href="https://github.com/webadderallorg/Recordly/issues">
					Recordly issue tracker
				</a>
				; account, privacy and billing details should remain private.
			</p>
		</Legal>
	);
}
