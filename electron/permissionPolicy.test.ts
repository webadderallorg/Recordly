import { describe, expect, it } from "vitest";

import {
	isTrustedCaptureDocumentUrl,
	shouldGrantDisplayCapture,
	shouldGrantMediaPermission,
} from "./permissionPolicy";

const TRUSTED_DOCUMENT_BASE_URLS = [
	"http://localhost:5173/",
	"http://127.0.0.1:43127/",
	"file:///C:/Program%20Files/Recordly/resources/app.asar/dist/index.html",
];

const DEV_HUD_URL = "http://localhost:5173/?windowType=hud-overlay";
const PACKAGED_HUD_URL = "http://127.0.0.1:43127/?windowType=hud-overlay";
const FILE_HUD_URL =
	"file:///C:/Program%20Files/Recordly/resources/app.asar/dist/index.html?windowType=hud-overlay";

describe("isTrustedCaptureDocumentUrl", () => {
	it.each([
		DEV_HUD_URL,
		PACKAGED_HUD_URL,
		FILE_HUD_URL,
		`${DEV_HUD_URL}#microphone`,
	])("accepts a Recordly HUD document: %s", (candidateUrl) => {
		expect(isTrustedCaptureDocumentUrl(candidateUrl, TRUSTED_DOCUMENT_BASE_URLS)).toBe(true);
	});

	it.each([
		"http://localhost:5173/",
		"http://localhost:5173/?windowType=editor",
		"http://localhost:5173/?windowType=HUD-OVERLAY",
		"http://localhost:5173/?windowType=hud-overlay&debug=1",
		"http://localhost:5173/?windowType=hud-overlay&windowType=hud-overlay",
		"http://localhost:5174/?windowType=hud-overlay",
		"http://localhost.evil.test:5173/?windowType=hud-overlay",
		"http://localhost:5173.evil.test/?windowType=hud-overlay",
		"http://user@localhost:5173/?windowType=hud-overlay",
		"https://localhost:5173/?windowType=hud-overlay",
		"http://127.0.0.1:43127/nested/?windowType=hud-overlay",
		"file:///C:/Program%20Files/Recordly/resources/app.asar/dist/other.html?windowType=hud-overlay",
		"file:///C:/Program%20Files/Recordly/resources/app.asar/dist/index.html/child?windowType=hud-overlay",
		"data:text/html,recordly?windowType=hud-overlay",
		"not a url",
	])("rejects a non-Recordly capture document: %s", (candidateUrl) => {
		expect(isTrustedCaptureDocumentUrl(candidateUrl, TRUSTED_DOCUMENT_BASE_URLS)).toBe(false);
	});

	it("ignores malformed trusted base URLs instead of throwing", () => {
		expect(
			isTrustedCaptureDocumentUrl(DEV_HUD_URL, ["not a url", ...TRUSTED_DOCUMENT_BASE_URLS]),
		).toBe(true);
	});
});

describe("shouldGrantMediaPermission", () => {
	const makeRequest = (
		overrides: Partial<Parameters<typeof shouldGrantMediaPermission>[0]> = {},
	): Parameters<typeof shouldGrantMediaPermission>[0] => ({
		permission: "media",
		isTrustedCaptureWindow: true,
		isMainFrame: true,
		currentDocumentUrl: DEV_HUD_URL,
		requestingUrl: DEV_HUD_URL,
		securityOrigins: ["http://localhost:5173"],
		...overrides,
	});

	it("grants camera or microphone media to the trusted HUD main frame", () => {
		expect(shouldGrantMediaPermission(makeRequest(), TRUSTED_DOCUMENT_BASE_URLS)).toBe(true);
	});

	it("accepts Chromium's trailing-slash HTTP origin serialization", () => {
		expect(
			shouldGrantMediaPermission(
				makeRequest({ securityOrigins: ["http://localhost:5173/"] }),
				TRUSTED_DOCUMENT_BASE_URLS,
			),
		).toBe(true);
	});

	it("accepts the packaged loopback renderer with its exact origin", () => {
		expect(
			shouldGrantMediaPermission(
				makeRequest({
					currentDocumentUrl: PACKAGED_HUD_URL,
					requestingUrl: PACKAGED_HUD_URL,
					securityOrigins: ["http://127.0.0.1:43127"],
				}),
				TRUSTED_DOCUMENT_BASE_URLS,
			),
		).toBe(true);
	});

	it.each([
		"null",
		"file://",
		"file:///",
	])("accepts Chromium's packaged file origin form: %s", (securityOrigin) => {
		expect(
			shouldGrantMediaPermission(
				makeRequest({
					currentDocumentUrl: FILE_HUD_URL,
					requestingUrl: FILE_HUD_URL,
					securityOrigins: [securityOrigin],
				}),
				TRUSTED_DOCUMENT_BASE_URLS,
			),
		).toBe(true);
	});

	it.each([
		["another permission", { permission: "display-capture" }],
		["another BrowserWindow", { isTrustedCaptureWindow: false }],
		["a subframe", { isMainFrame: false }],
		["an untrusted current document", { currentDocumentUrl: "https://example.com/" }],
		["a missing requesting document", { requestingUrl: "" }],
		["an untrusted requesting document", { requestingUrl: "https://example.com/" }],
		["a different trusted document", { requestingUrl: PACKAGED_HUD_URL }],
		["a mismatched origin", { securityOrigins: ["http://localhost:5174"] }],
		["an origin lookalike", { securityOrigins: ["http://localhost:5173.evil.test"] }],
		["an origin with credentials", { securityOrigins: ["http://user@localhost:5173/"] }],
		["an origin with a path", { securityOrigins: ["http://localhost:5173/other"] }],
		["an origin with a query", { securityOrigins: ["http://localhost:5173/?debug=1"] }],
		["a missing security origin", { securityOrigins: [] }],
		["an empty origin", { securityOrigins: [""] }],
	] as const)("denies %s", (_label, overrides) => {
		expect(shouldGrantMediaPermission(makeRequest(overrides), TRUSTED_DOCUMENT_BASE_URLS)).toBe(
			false,
		);
	});
});

describe("shouldGrantDisplayCapture", () => {
	const makeRequest = (
		overrides: Partial<Parameters<typeof shouldGrantDisplayCapture>[0]> = {},
	): Parameters<typeof shouldGrantDisplayCapture>[0] => ({
		isTrustedCaptureWindow: true,
		isMainFrame: true,
		currentDocumentUrl: DEV_HUD_URL,
		securityOrigin: "http://localhost:5173",
		videoRequested: true,
		...overrides,
	});

	it("grants selected-display video to the trusted HUD main frame", () => {
		expect(shouldGrantDisplayCapture(makeRequest(), TRUSTED_DOCUMENT_BASE_URLS)).toBe(true);
	});

	it("accepts a trailing slash on the display security origin", () => {
		expect(
			shouldGrantDisplayCapture(
				makeRequest({ securityOrigin: "http://localhost:5173/" }),
				TRUSTED_DOCUMENT_BASE_URLS,
			),
		).toBe(true);
	});

	it("accepts the packaged loopback renderer with its exact origin", () => {
		expect(
			shouldGrantDisplayCapture(
				makeRequest({
					currentDocumentUrl: PACKAGED_HUD_URL,
					securityOrigin: "http://127.0.0.1:43127",
				}),
				TRUSTED_DOCUMENT_BASE_URLS,
			),
		).toBe(true);
	});

	it.each(["null", "file://", "file:///"])(
		"accepts Chromium's packaged file origin form: %s",
		(securityOrigin) => {
			expect(
				shouldGrantDisplayCapture(
					makeRequest({ currentDocumentUrl: FILE_HUD_URL, securityOrigin }),
					TRUSTED_DOCUMENT_BASE_URLS,
				),
			).toBe(true);
		},
	);

	it.each([
		["another BrowserWindow", { isTrustedCaptureWindow: false }],
		["a subframe", { isMainFrame: false }],
		["a non-Recordly document", { currentDocumentUrl: "https://example.com/" }],
		["a mismatched origin", { securityOrigin: "http://127.0.0.1:43127" }],
		["a malformed origin", { securityOrigin: "not an origin" }],
		["an origin with a path", { securityOrigin: "http://localhost:5173/other" }],
		["an audio-only request", { videoRequested: false }],
	] as const)("denies %s", (_label, overrides) => {
		expect(shouldGrantDisplayCapture(makeRequest(overrides), TRUSTED_DOCUMENT_BASE_URLS)).toBe(
			false,
		);
	});
});
