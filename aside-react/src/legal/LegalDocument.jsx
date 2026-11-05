import React, { useEffect } from "react";
import { LEGAL_VERSION, legalDetails, legalReady } from "./config";
import { Nav, SiteFooter } from "../SiteHeader";
import "./legal.css";

export function LegalDocument({ title, description, children }) {
	const path = window.location.pathname.replace(/\/$/, "").replace(/^\/policy/, "");
	useEffect(() => {
		document.title = `${title} · Recordly`;
		const descriptionTag = document.querySelector('meta[name="description"]');
		descriptionTag?.setAttribute("content", description);
		const robots = document.createElement("meta");
		robots.name = "robots";
		robots.content = legalReady ? "index, follow" : "noindex, nofollow";
		document.head.append(robots);
		return () => robots.remove();
	}, [title, description]);
	return (
		<div className="policy-site">
			<a className="skip" href="#policy-content">
				Skip to content
			</a>
			<Nav light />
			<main id="policy-content" className="policy-content">
				<header className="policy-heading">
					<h1>{title}</h1>
					<p>{description}</p>
				</header>
				<article className="policy-document" aria-label={title}>
					{!legalReady && (
						<aside className="policy-draft" role="note">
							<strong>Draft for review</strong>
							<p>
								These documents are not yet effective. Operator review, support
								details and the effective date must be confirmed before publication
								or live billing.
							</p>
						</aside>
					)}
					{children}
					{path !== "/contact" && (
						<section className="policy-contact">
							<h2>Contact</h2>
							<p>
								Email: <a href={`mailto:${legalDetails.email}`}>{legalDetails.email}</a>
							</p>
						</section>
					)}
					<p className="policy-version">
						Version {LEGAL_VERSION}{legalReady && ` · Effective ${legalDetails.effectiveDate}`}
					</p>
				</article>
			</main>
			<SiteFooter />
		</div>
	);
}
