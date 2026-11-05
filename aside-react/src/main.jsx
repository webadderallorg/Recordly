import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "./styles.css";
import HeroVideo from "./HeroVideo";
import FeatureStack from "./FeatureStack";
import FeatureHighlights from "./FeatureHighlights";
import BillingPolicy from "./legal/BillingPolicy";
import Contact from "./legal/Contact";
import PrivacyPolicy from "./legal/PrivacyPolicy";
import TermsOfService from "./legal/TermsOfService";
import Blog from "./blog/Blog";
import Pricing from "./pricing/Pricing";
import { Logo, Download, Nav, SiteFooter } from "./SiteHeader";

// Set to { title, href } when there is a post worth highlighting in the hero.
const heroAnnouncement = null;

function App() {
	return (
		<>
			<a className="skip" href="#content">
				Skip to content
			</a>
			<section className="hero" id="top">
				<div className="hero-background-track" aria-hidden="true">
					<div className="hero-background" />
				</div>
				<Nav />
				<div className="hero-copy">
					{heroAnnouncement && (
						<a className="yc-badge" href={heroAnnouncement.href}>
							{heroAnnouncement.title} <span aria-hidden="true">›</span>
						</a>
					)}
					<h1>
						Beautiful, shareable
						<br className="desktop-break" /> screen recordings.
					</h1>
					<p className="hero-description">
						An opinionated, open-source screen recorder for beautiful output.
					</p>
					<div className="hero-actions">
						<Download />
					</div>
				</div>
				<HeroVideo />
			</section>
			<main id="content" className="page-body">
				<FeatureHighlights />
				<section id="capability" className="capability section" aria-label="Recordly features">
					<FeatureStack />
				</section>
				<section id="privacy" className="section privacy">
					<div className="section-title">
						<a className="eyebrow" href="/privacy">
							Privacy and control <span>›</span>
						</a>
						<h2>Your recording. <span className="serif">Your choice.</span></h2>
					</div>
					<p className="center-copy">
						Record and edit on your device. Export a video locally, or choose cloud
						sharing when you want a link.
					</p>
				</section>
			</main>
			<section className="closing">
				<Logo mark />
				<h2>
					Record. Edit. Share.
					<br />
					<span>Start using today.</span>
				</h2>
				<Download />
			</section>
			<SiteFooter />
		</>
	);
}

const legalRoutes = {
	"/privacy": PrivacyPolicy,
	"/policy/privacy": PrivacyPolicy,
	"/terms": TermsOfService,
	"/policy/terms": TermsOfService,
	"/billing": BillingPolicy,
	"/policy/billing": BillingPolicy,
	"/contact": Contact,
};
const LegalPage = legalRoutes[window.location.pathname.replace(/\/$/, "")];
const isBlog = /^\/blog(?:\/|$)/.test(window.location.pathname);
const isPricing = /^\/pricing\/?$/.test(window.location.pathname);
const root = document.getElementById("root");
const page = LegalPage ? <LegalPage /> : isPricing ? <Pricing /> : isBlog ? <Blog header={<Nav light />} path={window.location.pathname} /> : <App />;
if ((isBlog || isPricing) && root.hasAttribute("data-prerendered")) hydrateRoot(root, page);
else createRoot(root).render(page);
