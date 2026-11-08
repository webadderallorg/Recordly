import { loadEnv } from "vite";

const environment = { ...loadEnv("production", process.cwd(), "PUBLIC_"), ...process.env };
const required = [
	"PUBLIC_LEGAL_SUPPORT_EMAIL",
	"PUBLIC_LEGAL_PROCESSING_LOCATIONS",
	"PUBLIC_LEGAL_EFFECTIVE_DATE",
];
for (const key of required) {
	if (typeof environment[key] === "string") environment[key] = environment[key].trim();
}
const missing = required.filter((key) => !environment[key]?.trim());
if (environment.PUBLIC_LEGAL_APPROVED !== "true")
	missing.push("PUBLIC_LEGAL_APPROVED=true after operator review");
if (missing.length) {
	console.error(`Legal pages are still drafts. Confirm: ${missing.join(", ")}.`);
	process.exit(1);
}
if (
	!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(environment.PUBLIC_LEGAL_SUPPORT_EMAIL) ||
	!/^\d{4}-\d{2}-\d{2}$/.test(environment.PUBLIC_LEGAL_EFFECTIVE_DATE) ||
	required.some((key) =>
		/(?:example\.(?:com|org)|\[|\]|TODO|TBD|pending|placeholder)/i.test(environment[key]),
	)
) {
	console.error("Legal details are invalid or contain placeholders.");
	process.exit(1);
}
console.log(
	"Legal publication details are present. Operator review and mailbox verification remain required.",
);
