import billingCatalog from "../../services/email/billing/catalog.json";
import authCatalog from "../../services/supabase/templates/catalog.json";
import "./email-preview.css";

const catalog = [...authCatalog, ...billingCatalog];
const files = import.meta.glob<string>(
	["../../services/supabase/templates/*.html", "../../services/email/billing/*.html"],
	{
		eager: true,
		query: "?raw",
		import: "default",
	},
);
const originals: Record<string, string> = Object.fromEntries(
	catalog.map((item) => [
		item.id,
		files[
			`${"route" in item ? "../../services/supabase/templates" : "../../services/email/billing"}/${item.file}`
		],
	]),
);
const textFiles = import.meta.glob<string>(
	["../../services/supabase/templates/*.txt", "../../services/email/billing/*.txt"],
	{
		eager: true,
		query: "?raw",
		import: "default",
	},
);
const originalText: Record<string, string> = Object.fromEntries(
	catalog.map((item) => [
		item.id,
		textFiles[
			`${"route" in item ? "../../services/supabase/templates" : "../../services/email/billing"}/${item.file.replace(/\.html$/, ".txt")}`
		],
	]),
);
const select = (id: string) => document.getElementById(id) as HTMLSelectElement;
const variant = select("template");
const theme = select("theme");
const width = select("width");
const rendering = select("rendering");
const status = document.getElementById("status") as HTMLElement;
const frame = document.getElementById("preview") as HTMLIFrameElement;
const source = document.getElementById("source") as HTMLTextAreaElement;
const heading = document.getElementById("heading") as HTMLInputElement;
const message = document.getElementById("message") as HTMLTextAreaElement;
const editor = document.getElementById("editor") as HTMLElement;
const toggle = document.getElementById("toggle-editor") as HTMLButtonElement;
// Keep earlier exploratory drafts intact while previewing the published template schema.
const storageKey = () => `recordly-email-design-v2:${variant.value}`;
variant.replaceChildren(
	...["Authentication", "Security", "Subscriptions", "Billing"].map((category) => {
		const group = document.createElement("optgroup");
		group.label = category;
		for (const item of catalog.filter((item) => item.category === category)) {
			const option = document.createElement("option");
			option.value = item.id;
			option.textContent = item.label;
			group.append(option);
		}
		return group;
	}),
);

function readDraft() {
	try {
		return localStorage.getItem(storageKey()) ?? originals[variant.value];
	} catch {
		return originals[variant.value];
	}
}
function refreshFields() {
	const doc = new DOMParser().parseFromString(source.value, "text/html");
	heading.value = doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
	message.value = doc.querySelector(".email-intro")?.textContent ?? "";
}
function render() {
	const replacements: Record<string, string> = {
		Token: "482917",
		ConfirmationURL: "#preview-action",
		Email: "you@example.com",
		OldEmail: "previous@example.com",
		NewEmail: "new@example.com",
		Phone: "your new phone number",
		OldPhone: "your previous phone number",
		Provider: "Google",
		FactorType: "authenticator app",
		PlanName: "Recordly Cloud",
		PreviousPlan: "Recordly Free",
		Amount: "US$9.00",
		Interval: "month",
		RenewalDate: "28 November 2026",
		EffectiveDate: "28 October 2026",
		EndDate: "28 November 2026",
		TrialOutcome: "US$9.00 per month, billed automatically unless you cancel",
		PaymentDate: "28 October 2026",
		InvoiceNumber: "RCLY-1042",
		CardLast4: "4242",
		CardExpiry: "11 / 2026",
		RefundAmount: "US$9.00",
		RefundDate: "28 October 2026",
		DueDate: "4 November 2026",
		CreditAmount: "US$9.00",
		CreditDate: "28 October 2026",
		ActionURL: "https://videos.recordly.dev/billing",
	};
	const replaceSamples = (value: string) =>
		value.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (full, key: string) => replacements[key] ?? full);
	const html = replaceSamples(source.value).replace(
		/@media \(prefers-color-scheme:\s*dark\)/g,
		theme.value === "dark" ? "@media all" : "@media not all",
	);
	const doc = new DOMParser().parseFromString(html, "text/html");
	if (rendering.value === "blocked") {
		const policy = doc.createElement("meta");
		policy.httpEquiv = "Content-Security-Policy";
		policy.content = "img-src 'none'; font-src 'none'";
		doc.head.prepend(policy);
	} else if (rendering.value === "unstyled") {
		for (const style of doc.querySelectorAll("style")) style.remove();
		for (const node of doc.querySelectorAll<HTMLElement>("[style]"))
			node.removeAttribute("style");
		// Artwork is decorative; omit it when simulating clients stripping formatting.
		for (const image of doc.querySelectorAll("img")) image.remove();
	} else if (rendering.value === "plain") {
		let text = replaceSamples(originalText[variant.value]);
		if (source.value !== originals[variant.value]) {
			// Derive text from an edited draft; committed templates have explicit text alternatives.
			for (const node of doc.querySelectorAll("img, style, script, [aria-hidden='true']"))
				node.remove();
			for (const link of doc.querySelectorAll<HTMLAnchorElement>("a"))
				link.append(doc.createTextNode(` (${link.getAttribute("href")})`));
			for (const node of doc.querySelectorAll("h1,p,tr"))
				node.append(doc.createTextNode("\n\n"));
			for (const node of doc.querySelectorAll("td")) node.append(doc.createTextNode(" "));
			text = (doc.body.textContent ?? "")
				.replace(/[ \t]+/g, " ")
				.replace(/\n\s*\n/g, "\n\n")
				.trim();
		}
		doc.head.replaceChildren();
		doc.body.removeAttribute("style");
		doc.body.removeAttribute("class");
		const pre = doc.createElement("pre");
		pre.style.cssText =
			"white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.7 monospace;margin:24px;color:#18181b;background:white;";
		pre.textContent = text;
		doc.body.replaceChildren(pre);
	}
	// No preview action can navigate to a real billing or authentication flow.
	for (const link of doc.querySelectorAll<HTMLAnchorElement>("a")) {
		if (!link.href.startsWith("mailto:") && !link.href.includes("/privacy"))
			link.href = "#preview-action";
	}
	frame.srcdoc = `<!doctype html>\n${doc.documentElement.outerHTML}`;
	const isBilling = billingCatalog.some((item) => item.id === variant.value);
	const modeNote: Record<string, string> = {
		normal: "",
		blocked: " · simulation: images and web fonts blocked",
		unstyled: " · simulation: formatting and artwork removed",
		plain: " · plain-text alternative",
	};
	status.textContent = `${isBilling ? "Billing design · sending not connected" : "Account email design"} · sample data · no email is sent${modeNote[rendering.value]}`;
	frame.classList.toggle("mobile", width.value === "mobile");
}
function saveDraft() {
	try {
		localStorage.setItem(storageKey(), source.value);
	} catch {
		/* Optional local persistence. */
	}
	render();
}
function updateCopy() {
	const doc = new DOMParser().parseFromString(source.value, "text/html");
	const title = doc.querySelector("h1");
	const intro = doc.querySelector(".email-intro");
	if (!title || !intro) return;
	const brand = title.querySelector(".email-title-brand")?.cloneNode(true);
	const brandIndex = heading.value.lastIndexOf("Recordly");
	if (brand && brandIndex >= 0)
		title.replaceChildren(
			doc.createTextNode(heading.value.slice(0, brandIndex)),
			brand,
			doc.createTextNode(heading.value.slice(brandIndex + "Recordly".length)),
		);
	else title.textContent = heading.value;
	title.setAttribute("aria-label", heading.value);
	intro.textContent = message.value;
	source.value = `<!doctype html>\n${doc.documentElement.outerHTML}`;
	saveDraft();
}
variant.addEventListener("change", () => {
	source.value = readDraft();
	refreshFields();
	render();
});
for (const control of [theme, width, rendering]) control.addEventListener("change", render);
source.addEventListener("input", () => {
	refreshFields();
	saveDraft();
});
heading.addEventListener("input", updateCopy);
message.addEventListener("input", updateCopy);
toggle.addEventListener("click", () => {
	editor.hidden = !editor.hidden;
	toggle.setAttribute("aria-expanded", String(!editor.hidden));
});
document.getElementById("reset")?.addEventListener("click", () => {
	try {
		localStorage.removeItem(storageKey());
	} catch {
		/* Optional local persistence. */
	}
	source.value = originals[variant.value];
	refreshFields();
	render();
});
source.value = readDraft();
refreshFields();
render();
