import { LEGAL_VERSION, legalDetails, legalReady } from "./config";
import { RecordlyLegalHeader, RecordlyLegalFooter } from "./RecordlyLegalNavigation";

export function RecordlyLegalDocument({ title, description, children }) {
	return (
		<div className="policy-site">
			<a className="skip" href="#policy-content">Skip to content</a>
			<RecordlyLegalHeader />
			<main id="policy-content" className="policy-content">
				<header className="policy-heading"><h1>{title}</h1><p>{description}</p></header>
				<article className="policy-document" aria-label={title}>
					{!legalReady && <div className="policy-draft" role="note"><strong>Draft for review</strong><p>These documents are not yet effective. Operator review, support details and the effective date must be confirmed before publication or live billing.</p></div>}
					{children}
					<section className="policy-contact"><h2>Contact</h2><p>Email: <a href={`mailto:${legalDetails.email}`}>{legalDetails.email}</a></p></section>
					<p className="policy-version">Version {LEGAL_VERSION}{legalReady && ` · Effective ${legalDetails.effectiveDate}`}</p>
				</article>
			</main>
			<RecordlyLegalFooter />
		</div>
	);
}
