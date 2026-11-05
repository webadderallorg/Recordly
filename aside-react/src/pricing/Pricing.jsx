import React, { useEffect, useState } from "react";
import { Nav, SiteFooter } from "../SiteHeader";
import { applyBlogMetadata, siteOrigin } from "../blog/seo";
import { catalogUrl, parseCatalog, dollars, gigabytes, pricingMetadata } from "./catalog.js";
import "./pricing.css";

const download = "https://github.com/webadderallorg/Recordly/releases/latest";
function Feature({ children, included = false }) {
  return <li><span className={included ? "plan-included" : "plan-check"} aria-hidden="true">{included ? "+" : "✓"}</span><span>{children}</span></li>;
}

export default function Pricing() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { applyBlogMetadata(pricingMetadata(siteOrigin)); }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each retry attempt explicitly refetches the current catalog.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setError(false);
    setCatalog(null);
    fetch(catalogUrl, {credentials:"omit", cache:"no-store", signal:controller.signal})
      .then((response) => { if (!response.ok) throw new Error("Unavailable"); return response.json(); })
      .then(parseCatalog)
      .then((value) => { if (active) setCatalog(value); })
      .catch(() => { if (active) setError(true); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  return (
    <div className="pricing-site">
      <a className="skip" href="#pricing-content">Skip to content</a>
      <Nav light />
      <main id="pricing-content" className="pricing-content">
        <header className="pricing-heading">
          <h1>Record and edit for free.<br />Upgrade your cloud sharing.</h1>
          <p>Free includes local video exports and limited cloud sharing. Cloud adds SRT and VTT caption-file exports, larger uploads, more storage, and links that stay live while your subscription is active.</p>
          <p className="pricing-interval">Cloud is billed monthly</p>
        </header>
        <div className="pricing-plans">
          <section className="pricing-plan" aria-labelledby="free-plan">
            <h2 id="free-plan">Free <span>For getting started.</span></h2>
            <p className="plan-price"><span>$0</span><span className="plan-period">/ forever</span></p>
            <ul>
              <Feature>Screen and webcam recording</Feature>
              <Feature>Automatic zooms and smooth cursors</Feature>
              <Feature>Backgrounds, captions and editing tools</Feature>
              <Feature>MP4 and GIF exports</Feature>
              <Feature>{catalog ? `${catalog.freeRecordings} cloud recordings` : "Limited cloud sharing"}</Feature>
              {catalog && <Feature>Uploads up to {gigabytes(catalog.freeBytes)} each</Feature>}
            </ul>
            <a className="plan-action plan-action-free" href={download}>Download Recordly <span aria-hidden="true">↓</span></a>
          </section>
          <section className="pricing-plan" aria-labelledby="cloud-plan">
            <h2 id="cloud-plan">Cloud <span>For sharing more.</span></h2>
            <div className="cloud-price-area" aria-live="polite">
              {catalog ? <>
                <p className="plan-price"><span>{dollars(catalog.amount)}</span><span className="plan-period">USD / month</span></p>
                {catalog.regular && <p className="plan-offer"><span>Early bird</span><s>{dollars(catalog.regular)} USD / month</s></p>}
              </> : <p className="plan-price-status">{error ? "Pricing is temporarily unavailable." : "Loading current price…"}</p>}
              {error && <button className="pricing-retry" onClick={() => setAttempt((n) => n + 1)}>Retry pricing</button>}
            </div>
            <ul>
              <Feature included>Everything in Free</Feature>
              <Feature>Export captions as SRT and VTT files</Feature>
              <Feature>Share videos in high-definition 1080p</Feature>
              <Feature>{!catalog ? "Cloud storage and bandwidth" : catalog.storageBytes === null ? "Unlimited cloud storage and bandwidth" : `${gigabytes(catalog.storageBytes)} cloud storage`}</Feature>
              <Feature>{catalog ? `Uploads up to ${gigabytes(catalog.cloudBytes)} each` : "Larger cloud uploads"}</Feature>
              <Feature>Shared links stay live while Cloud is active</Feature>
              {catalog?.weeklyUploads && <Feature>{catalog.weeklyUploads} uploads per rolling 7 days</Feature>}
              <Feature>Support Recordly’s development</Feature>
            </ul>
            <a className="plan-action plan-action-cloud" href={download}>Download to get Cloud <span aria-hidden="true">↓</span></a>
          </section>
        </div>
        <p className="pricing-note">Cloud renews monthly until cancelled. Upload and fair-use limits apply. Confirm your total at checkout.</p>
        <p className="pricing-policy"><a href="/billing">Billing & refunds</a><span aria-hidden="true"> · </span><a href="/contact">Questions? Get in touch</a></p>
      </main>
      <SiteFooter />
    </div>
  );
}
