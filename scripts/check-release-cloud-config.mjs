import { pathToFileURL } from "node:url";

// Release jobs pass these explicitly. Do not load a developer's .env.local here.
export function releaseCloudConfigErrors(env) {
	const errors = [];
	const httpsUrl = (name) => {
		try {
			const url = new URL(env[name] || "");
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				url.port ||
				url.search ||
				url.hash ||
				/YOUR_|REPLACE|example\./i.test(url.href)
			)
				throw new Error();
			return url;
		} catch {
			errors.push(
				`${name} must be a configured HTTPS URL without credentials, query or fragment.`,
			);
			return null;
		}
	};
	const endpoint = httpsUrl("VITE_CLOUD_SHARE_ENDPOINT");
	if (endpoint && endpoint.href !== "https://videos.recordly.dev/api/upload") {
		errors.push(
			"VITE_CLOUD_SHARE_ENDPOINT must target the production Recordly upload service.",
		);
	}
	const auth = httpsUrl("VITE_SUPABASE_URL");
	if (auth && auth.pathname !== "/")
		errors.push("VITE_SUPABASE_URL must be the auth project origin.");
	const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
	let publicKey = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key) && !/YOUR_|REPLACE/i.test(key);
	// Older Supabase projects use an anon JWT. Reject service-role JWTs explicitly.
	if (!publicKey) {
		try {
			publicKey =
				key.split(".").length === 3 &&
				JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon";
		} catch {
			/* Missing or malformed public configuration. */
		}
	}
	if (!publicKey)
		errors.push("VITE_SUPABASE_PUBLISHABLE_KEY must be a public publishable key or anon JWT.");
	return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const errors = releaseCloudConfigErrors(process.env);
	if (errors.length) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	} else {
		console.log(
			"Production cloud and public sign-in configuration present. Live service validation is still required.",
		);
	}
}
