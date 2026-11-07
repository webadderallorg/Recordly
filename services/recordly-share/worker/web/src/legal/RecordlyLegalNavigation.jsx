import recordlyMark from "./assets/recordly-mark.svg?url";

const links = [
	["/privacy", "Privacy"],
	["/terms", "Terms"],
	["/billing", "Billing & refunds"],
	["/contact", "Contact"],
];

function LegalLinks() {
	return links.map(([href, label]) => <a key={href} href={href} aria-current={href === "/terms" ? "page" : undefined}>{label}</a>);
}

export function RecordlyLegalHeader() {
	return (
		<header className="nav nav-light">
			<a href="/terms" aria-label="Recordly terms"><span className="recordly-logo"><img src={recordlyMark} alt="" width="24" height="24" /><span>Recordly</span></span></a>
			<nav className="legal-navigation" aria-label="Legal and support"><LegalLinks /></nav>
			<details className="legal-menu"><summary aria-label="Legal and support">☰</summary><nav aria-label="Legal and support"><LegalLinks /></nav></details>
		</header>
	);
}

export function RecordlyLegalFooter() {
	return <footer className="site-footer"><a href="/terms">© {new Date().getFullYear()} Recordly</a><nav aria-label="Legal and support footer"><LegalLinks /></nav></footer>;
}
