const path = require("node:path");
const { readFileSync } = require("node:fs");
const JSON5 = require("json5");

// Partner Center > Product management > Product identity. Never invent these
// values: Store certification matches them against the reserved product.
module.exports = function storeConfiguration(_context, environment = process.env) {
	const required = (name) => {
		const value = environment[name]?.trim();
		if (!value) throw new Error(`Missing ${name}; see docs/microsoft-store.md.`);
		return value;
	};
	const identityName = required("RECORDLY_STORE_IDENTITY_NAME");
	const publisher = required("RECORDLY_STORE_PUBLISHER");
	const publisherDisplayName = required("RECORDLY_STORE_PUBLISHER_DISPLAY_NAME");
	const version = required("RECORDLY_STORE_VERSION");
	if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) {
		throw new Error(
			"RECORDLY_STORE_IDENTITY_NAME must match the Partner Center package identity.",
		);
	}
	if (!publisher.startsWith("CN=")) {
		throw new Error(
			"RECORDLY_STORE_PUBLISHER must be the exact CN= publisher from Partner Center.",
		);
	}
	if (
		!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
		version.split(".").some((part) => Number(part) > 65535) ||
		version.startsWith("0.")
	) {
		throw new Error(
			"RECORDLY_STORE_VERSION must be major.minor.patch (major 1–65535, others 0–65535). Store revision is always 0.",
		);
	}
	// electron-builder 26 inserts these strings verbatim into its XML template.
	const xml = (value) =>
		value.replace(
			/[&<>"']/g,
			(char) =>
				({
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					'"': "&quot;",
					"'": "&apos;",
				})[char],
		);
	// Builder's `extends` concatenates target arrays and would also build NSIS.
	// Copy the base explicitly so this build contains only the Store target.
	const base = JSON5.parse(readFileSync(path.join(__dirname, "electron-builder.json5"), "utf8"));
	return {
		...base,
		extends: null,
		directories: { ...base.directories, output: "release/store" },
		extraMetadata: { ...base.extraMetadata, version },
		publish: null,
		forceCodeSigning: false,
		win: {
			...base.win,
			target: [{ target: "appx", arch: ["x64"] }],
			artifactName: "${productName}-store-${version}-${arch}.${ext}",
			// Keep icon/resource editing, but let Microsoft sign the package.
			signExecutable: false,
			publish: null,
		},
		appx: {
			identityName,
			publisher: xml(publisher),
			publisherDisplayName: xml(publisherDisplayName),
			applicationId: "Recordly",
			displayName: "Recordly",
			backgroundColor: "transparent",
			minVersion: "10.0.19041.0",
			maxVersionTested: "10.0.26100.0",
			setBuildNumber: false,
			electronUpdaterAware: false,
			capabilities: ["runFullTrust", "internetClient", "microphone", "webcam"],
		},
	};
};
