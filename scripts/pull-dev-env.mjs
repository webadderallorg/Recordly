#!/usr/bin/env node
// Fills .env with public sign-in and Cloud settings stored as GitHub repository
// variables. Existing values are never overwritten.
// See docs/cloud-sharing.md for choosing a local Cloud endpoint.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const KEYS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_CLOUD_SHARE_ENDPOINT"];
const envPath = path.resolve(process.cwd(), ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

function hasValue(key) {
	const match = existing.match(new RegExp(`^${key}=(.*)$`, "m"));
	const value = match?.[1]?.trim();
	return Boolean(value && !value.includes("YOUR_"));
}

const missing = KEYS.filter((key) => !hasValue(key));
if (missing.length === 0) {
	console.log(".env already has sign-in and Cloud settings.");
	process.exit(0);
}

const lines = [];
for (const key of missing) {
	try {
		const value = execFileSync("gh", ["variable", "get", key], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (value) lines.push(`${key}=${value}`);
	} catch {
		console.warn(`Couldn't read ${key} with gh. Run "gh auth login" or copy .env.example.`);
	}
}

if (lines.length === 0) process.exit(0);

// Drop placeholder lines for keys we're replacing.
const kept = existing
	.split("\n")
	.filter((line) => !missing.some((key) => line.startsWith(`${key}=`)))
	.join("\n")
	.trimEnd();
fs.writeFileSync(envPath, `${kept ? `${kept}\n` : ""}${lines.join("\n")}\n`);
console.log(`Wrote ${lines.map((line) => line.split("=")[0]).join(", ")} to .env.`);
