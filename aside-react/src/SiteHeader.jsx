import React, { useEffect, useId, useRef, useState } from "react";
import { downloadPlatforms, getDownloadPlatform } from "./downloadPlatforms";

import recordlyMark from "../public/assets/recordly-mark.svg?url";
import recordlyMarkWhite from "../public/assets/recordly-mark-white.svg?url";
const ASSET = "/assets/";
const groups = {
	Features: [
		["Automatic zoom", "#showcase"],
		["Recording and editing", "#capability"],
		["Cloud sharing", "#feature-sharing"],
	],
	Blog: [
		["All posts", "/blog"],
	],
	Resources: [
		["Source code", "https://github.com/webadderallorg/Recordly"],
		["Releases", "https://github.com/webadderallorg/Recordly/releases"],
		["Privacy policy", "/privacy"],
		["Terms of service", "/terms"],
		["Billing & refunds", "/billing"],
		["Contact", "/contact"],
	],
};
function Logo({ mark = false, light = false, ...props }) {
	if (mark) return <img src={recordlyMark} alt="" {...props} />;
	return (
		<span className="recordly-logo" {...props}>
			<img src={light ? recordlyMark : recordlyMarkWhite} alt="" />
			<span>Recordly</span>
		</span>
	);
}
function Download({ compact = false }) {
	const [open, setOpen] = useState(false);
	const [platform, setPlatform] = useState("macos");
	const selected = downloadPlatforms.find(({ id }) => id === platform);
	const ref = useRef(null);
	const trigger = useRef(null);
	const optionsId = useId();
	useEffect(() => {
		setPlatform(getDownloadPlatform(navigator));
	}, []);
	useEffect(() => {
		if (!open) return;
		const closeOutside = (event) => {
			if (!ref.current?.contains(event.target)) setOpen(false);
		};
		const onEscape = (event) => {
			if (event.key === "Escape") {
				setOpen(false);
				trigger.current?.focus();
			}
		};
		document.addEventListener("pointerdown", closeOutside);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
			document.removeEventListener("keydown", onEscape);
		};
	}, [open]);
	const primary = (
		<a className={`download ${compact ? "compact" : ""}`} href={selected.href}>
			{!compact && <img className="download-mark" src={recordlyMarkWhite} alt="" width="20" height="20" />}
			{compact ? "Download" : `Download for ${selected.label}`}
		</a>
	);
	if (compact) return primary;
	return (
		<div className="download-split" ref={ref} onBlur={(event) => {
			if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
		}}>
			{primary}
			<button
				type="button"
				className="download-toggle"
				ref={trigger}
				aria-label="Other download platforms"
				aria-expanded={open}
				aria-controls={optionsId}
				onClick={() => setOpen(!open)}
			>
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
					<path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</button>
			<div className="download-options" id={optionsId} hidden={!open}>
				{downloadPlatforms.filter(({ id }) => id !== platform).map(({ id, label, href }) => (
					<a key={id} href={href} onClick={() => setOpen(false)}>
						<img className="download-platform-icon" src={`${ASSET}platform-${id}.svg`} width="18" height="18" alt="" />
						{label}
					</a>
				))}
			</div>
		</div>
	);
}
function Nav({ light = false, siteLinks = {} }) {
	const { home = "/", blog = "/blog", pricing = "/pricing", features } = siteLinks;
	const [mobile, setMobile] = useState(false);
	const [open, setOpen] = useState(null);
	const ref = useRef(null);
	useEffect(() => {
		const close = (e) => {
			if (!ref.current?.contains(e.target)) setOpen(null);
		};
		const onEscape = (e) => {
			if (e.key === "Escape") {
				setOpen(null);
				setMobile(false);
			}
		};
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", onEscape);
		};
	}, []);
	return (
		<header className={`nav${light ? " nav-light" : ""}`} ref={ref}>
			<a href={home} aria-label="Recordly home">
				<Logo light={light} />
			</a>
			<button
				className="menu-toggle"
				aria-expanded={mobile}
				aria-controls="navigation"
				onClick={() => setMobile(!mobile)}
				aria-label={mobile ? "Close navigation" : "Open navigation"}
			>
				{mobile ? "✕" : "☰"}
			</button>
			<nav id="navigation" className={mobile ? "is-open" : ""} aria-label="Main navigation">
				{Object.entries(groups).map(([name, links]) => name === "Blog" ? (
					<a key={name} href={blog} onClick={() => { setOpen(null); setMobile(false); }}>Blog</a>
				) : (
					<div className="nav-group" key={name}>
						<button
							aria-expanded={open === name}
							aria-controls={`menu-${name.replaceAll(" ", "-")}`}
							onClick={() => setOpen(open === name ? null : name)}
						>
							{name}
							<span className="chevron" aria-hidden="true">
								⌄
							</span>
						</button>
						{open === name && (
							<div id={`menu-${name.replaceAll(" ", "-")}`} className="dropdown">
								{links.map(([label, href]) => (
									<a
										key={label}
										href={href.startsWith("#") ? features || (light ? `/${href}` : href) : href}
										onClick={() => {
											setOpen(null);
											setMobile(false);
										}}
									>
										{label}
										<span aria-hidden="true">↗</span>
									</a>
								))}
							</div>
						)}
					</div>
				))}
				{pricing && <a href={pricing}>Pricing</a>}
			</nav>
			<div className="nav-download">
				<Download compact />
			</div>
		</header>
	);
}
function SiteFooter({ home = "/" }) {
	return <footer className="site-footer"><a href={home}>© {new Date().getFullYear()} Recordly</a><nav aria-label="Footer"><a href="https://github.com/webadderallorg/Recordly">GitHub ↗</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/billing">Billing & refunds</a><a href="/contact">Contact</a></nav></footer>;
}
export { Logo, Download, Nav, SiteFooter };
