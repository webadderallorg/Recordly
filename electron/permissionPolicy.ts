const CAPTURE_WINDOW_TYPE = "hud-overlay";
const TRUSTED_RENDERER_PROTOCOLS = new Set(["http:", "https:", "file:"]);
const FILE_SECURITY_ORIGINS = new Set(["null", "file://", "file:///"]);

export interface MediaPermissionPolicyRequest {
	permission: string;
	isTrustedCaptureWindow: boolean;
	isMainFrame: boolean;
	currentDocumentUrl: string;
	requestingUrl: string;
	securityOrigins: readonly string[];
}

export interface DisplayCapturePolicyRequest {
	isTrustedCaptureWindow: boolean;
	isMainFrame: boolean;
	currentDocumentUrl: string;
	securityOrigin: string;
	videoRequested: boolean;
}

function parseUrl(value: string): URL | null {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function hasExactCaptureWindowQuery(url: URL): boolean {
	const entries = [...url.searchParams.entries()];
	return (
		entries.length === 1 &&
		entries[0]?.[0] === "windowType" &&
		entries[0][1] === CAPTURE_WINDOW_TYPE
	);
}

function isValidTrustedBaseUrl(url: URL): boolean {
	return (
		TRUSTED_RENDERER_PROTOCOLS.has(url.protocol) &&
		url.username === "" &&
		url.password === "" &&
		url.search === "" &&
		url.hash === ""
	);
}

function hasSameBaseLocation(candidate: URL, trustedBase: URL): boolean {
	return (
		candidate.protocol === trustedBase.protocol &&
		candidate.hostname === trustedBase.hostname &&
		candidate.port === trustedBase.port &&
		candidate.pathname === trustedBase.pathname
	);
}

export function isTrustedCaptureDocumentUrl(
	candidateUrl: string,
	trustedDocumentBaseUrls: readonly string[],
): boolean {
	const candidate = parseUrl(candidateUrl);
	if (
		!candidate ||
		!TRUSTED_RENDERER_PROTOCOLS.has(candidate.protocol) ||
		candidate.username !== "" ||
		candidate.password !== "" ||
		!hasExactCaptureWindowQuery(candidate)
	) {
		return false;
	}

	return trustedDocumentBaseUrls.some((trustedBaseUrl) => {
		const trustedBase = parseUrl(trustedBaseUrl);
		return Boolean(
			trustedBase &&
				isValidTrustedBaseUrl(trustedBase) &&
				hasSameBaseLocation(candidate, trustedBase),
		);
	});
}

function isSameDocument(firstUrl: string, secondUrl: string): boolean {
	const first = parseUrl(firstUrl);
	const second = parseUrl(secondUrl);
	if (!first || !second) {
		return false;
	}

	first.hash = "";
	second.hash = "";
	return first.href === second.href;
}

function isSecurityOriginForDocument(securityOrigin: string, documentUrl: string): boolean {
	const document = parseUrl(documentUrl);
	if (!document) {
		return false;
	}

	if (document.protocol === "file:") {
		return FILE_SECURITY_ORIGINS.has(securityOrigin);
	}

	const origin = parseUrl(securityOrigin);
	return Boolean(
		origin &&
			(origin.protocol === "http:" || origin.protocol === "https:") &&
			origin.username === "" &&
			origin.password === "" &&
			origin.origin === document.origin &&
			origin.pathname === "/" &&
			origin.search === "" &&
			origin.hash === "",
	);
}

export function shouldGrantMediaPermission(
	request: MediaPermissionPolicyRequest,
	trustedDocumentBaseUrls: readonly string[],
): boolean {
	if (
		request.permission !== "media" ||
		!request.isTrustedCaptureWindow ||
		!request.isMainFrame ||
		!isTrustedCaptureDocumentUrl(request.currentDocumentUrl, trustedDocumentBaseUrls)
	) {
		return false;
	}

	if (
		!isTrustedCaptureDocumentUrl(request.requestingUrl, trustedDocumentBaseUrls) ||
		!isSameDocument(request.currentDocumentUrl, request.requestingUrl)
	) {
		return false;
	}

	return (
		request.securityOrigins.length > 0 &&
		request.securityOrigins.every((securityOrigin) =>
			isSecurityOriginForDocument(securityOrigin, request.currentDocumentUrl),
		)
	);
}

export function shouldGrantDisplayCapture(
	request: DisplayCapturePolicyRequest,
	trustedDocumentBaseUrls: readonly string[],
): boolean {
	return (
		request.isTrustedCaptureWindow &&
		request.isMainFrame &&
		request.videoRequested &&
		isTrustedCaptureDocumentUrl(request.currentDocumentUrl, trustedDocumentBaseUrls) &&
		isSecurityOriginForDocument(request.securityOrigin, request.currentDocumentUrl)
	);
}
