import { buildEmailHtml, buildEmailText } from "./render-email.mjs";

// Pass an item from billing/catalog.json and server-verified billing values.
// This module only renders; it does not select recipients or send email.
export function renderBillingEmail(template, values) {
	if (!["Subscriptions", "Billing"].includes(template.category))
		throw new Error("Expected a billing email template");
	const interpolate = (value) =>
		value.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_match, key) => {
			const replacement = values[key];
			if (
				typeof replacement !== "string" ||
				!replacement.trim() ||
				replacement.length > 2000 ||
				/[\r\n]/.test(replacement) ||
				replacement.includes("\0")
			)
				throw new Error(`Missing or invalid billing email value: ${key}`);
			return replacement;
		});
	const item = {
		...template,
		subject: interpolate(template.subject),
		preheader: template.preheader ? interpolate(template.preheader) : undefined,
		heading: interpolate(template.heading),
		message: interpolate(template.message),
		facts: template.facts?.map(([label, value]) => [label, interpolate(value)]),
		detail: template.detail ? interpolate(template.detail) : undefined,
		footer: interpolate(template.footer),
		actionUrl: interpolate(template.actionUrl),
	};
	let url;
	try {
		url = new URL(item.actionUrl);
	} catch {
		throw new Error("Unsupported billing action URL");
	}
	// Do not turn arbitrary webhook metadata into links in trusted billing mail.
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.port ||
		![
			"videos.recordly.dev",
			"billing.stripe.com",
			"invoice.stripe.com",
			"pay.stripe.com",
			"payments.stripe.com",
		].includes(url.hostname)
	)
		throw new Error("Unsupported billing action URL");
	return { subject: item.subject, html: buildEmailHtml(item), text: buildEmailText(item) };
}
