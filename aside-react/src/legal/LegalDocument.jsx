import React, { useEffect } from "react";
import { LEGAL_VERSION, legalDetails, legalReady } from "./config";
import { Nav, SiteFooter } from "../SiteHeader";
import "./legal.css";

export function LegalDocument({ title, description, children, publication, siteLinks }) {
	const details = publication?.details ?? legalDetails;
	const ready = publication?.ready ?? legalReady;
	const version = publication?.version ?? LEGAL_VERSION;
	const path = (typeof window === "undefined" ? "/terms" : window.location.pathname).replace(/\/$/, "").replace(/^\/policy/, "");
	useEffect(() => {
		document.title = `${title} · Recordly`;
		const descriptionTag = document.querySelector('meta[name="description"]');
		descriptionTag?.setAttribute("content", description);
		const existingRobots = document.querySelector('meta[name="robots"]');
		const robots = existingRobots || document.createElement("meta");
		const previousRobots = robots.content;
		robots.name = "robots";
		robots.content = ready ? "index, follow" : "noindex, nofollow";
		if (!existingRobots) document.head.append(robots);
		return () => {
			if (existingRobots) robots.content = previousRobots;
			else robots.remove();
		};
	}, [title, description, ready]);
	return (
		<div className="policy-site">
			<a className="skip" href="#policy-content">
				Skip to content
			</a>
			<Nav light siteLinks={siteLinks} />
			<main id="policy-content" className="policy-content">
				<header className="policy-heading">
					<h1>{title}</h1>
					<p>{description}</p>
				</header>
				<article className="policy-document" aria-label={title}>
					{!ready && (
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
								Email: <a href={`mailto:${details.email}`}>{details.email}</a>
							</p>
						</section>
					)}
					<p className="policy-version">
						Version {version}{ready && ` · Effective ${details.effectiveDate}`}
					</p>
				</article>
			</main>
			<SiteFooter home={siteLinks?.home} />
		</div>
	);
}
