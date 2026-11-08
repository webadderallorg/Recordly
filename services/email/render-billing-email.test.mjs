import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { renderBillingEmail } from "./render-billing-email.mjs";

const catalog = JSON.parse(fs.readFileSync(new URL("./billing/catalog.json", import.meta.url)));
const values = {
	PlanName: "Recordly Cloud",
	PreviousPlan: "Recordly Free",
	Amount: "US$9.00",
	Interval: "month",
	RenewalDate: "28 November 2026",
	EffectiveDate: "28 October 2026",
	EndDate: "28 November 2026",
	TrialOutcome: "Returns to Free unless you subscribe",
	PaymentDate: "28 October 2026",
	InvoiceNumber: "RCLY-1042",
	CardLast4: "4242",
	CardExpiry: "11 / 2026",
	RefundAmount: "US$9.00",
	RefundDate: "28 October 2026",
	DueDate: "4 November 2026",
	CreditAmount: "US$9.00",
	CreditDate: "28 October 2026",
	ActionURL: "https://billing.stripe.com/p/session/example?a=1&b=2",
};

test("every billing message has complete HTML and a usable text alternative", () => {
	assert.equal(catalog.length, 14);
	assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
	for (const item of catalog) {
		const message = renderBillingEmail(item, values);
		assert.doesNotMatch(message.html + message.text + message.subject, /\{\{/);
		assert.ok(message.text.includes(`${item.action}: ${values.ActionURL}`), item.id);
		assert.ok(
			message.html.includes("https://billing.stripe.com/p/session/example?a=1&amp;b=2"),
		);
		for (const [, field] of item.facts) {
			const key = field.match(/\{\{\s*\.(\w+)\s*\}\}/)?.[1];
			if (key) assert.ok(message.text.includes(values[key]), `${item.id}: ${key}`);
		}
		assert.ok(message.text.includes("support@recordly.dev"));
		assert.doesNotMatch(message.html, /<script|<form|<iframe/);
	}
});

test("escapes customer-facing text without corrupting the plain alternative", () => {
	const name = 'Cloud <img src=x onerror="alert(1)"> & more';
	const message = renderBillingEmail(catalog[0], { ...values, PlanName: name });
	assert.ok(
		message.html.includes("Cloud &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; more"),
	);
	assert.ok(message.text.includes(name));
});

test("missing billing facts and header newlines fail closed", () => {
	assert.throws(() => renderBillingEmail(catalog[0], { ...values, Amount: "" }), /Amount/);
	assert.throws(
		() => renderBillingEmail(catalog[0], { ...values, PlanName: "Cloud\r\nBcc: someone" }),
		/PlanName/,
	);
});

test("rejects unsafe or untrusted payment links", () => {
	for (const ActionURL of [
		"not-an-absolute-url",
		"javascript:alert(1)",
		"http://billing.stripe.com/x",
		"https://billing.stripe.com.evil.example/x",
		"https://user:pass@billing.stripe.com/x",
		"https://billing.stripe.com:444/x",
	]) {
		assert.throws(
			() => renderBillingEmail(catalog[0], { ...values, ActionURL }),
			/Unsupported/,
		);
	}
});

test("subscription notices defer recording retention to the Terms without inventing expiry guarantees", () => {
	for (const id of [
		"subscription-active",
		"subscription-cancellation-scheduled",
		"subscription-ended",
	]) {
		const item = catalog.find((candidate) => candidate.id === id);
		assert.ok(item, id);
		const message = renderBillingEmail(item, values);
		for (const body of [message.html, message.text]) {
			assert.ok(body.includes("https://videos.recordly.dev/terms"), id);
			assert.doesNotMatch(
				body,
				/7 days|seven.day|lose all access|keep.*no.expiry.*after cancellation/i,
			);
		}
	}
});
