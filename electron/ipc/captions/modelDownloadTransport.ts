import { isIP } from "node:net";
import type { Readable } from "node:stream";
import { type IncomingMessage, net, type Session, session } from "electron";

const IDLE_TIMEOUT_MS = 30_000;
const PROXY_DEFAULT_PORTS = new Map([
	["http:", 80],
	["https:", 443],
	["socks4:", 1080],
	["socks5:", 1080],
]);

type CaptionProxy = {
	session: Session;
	credentials?: {
		host: string;
		port: number;
		username: string;
		password: string;
	};
};

// Electron documents IncomingMessage as a Readable, but its declaration omits that base class.
type DownloadResponse = IncomingMessage & Readable;

let configuredProxy: Promise<CaptionProxy> | undefined;

function chromiumBypassRules(noProxy?: string): string | undefined {
	return noProxy
		?.split(",")
		.flatMap((entry) => {
			const rule = entry.trim();
			if (!rule) return [];
			if (isIP(rule) === 6) return `[${rule}]`;
			const domain = /^\.?([a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?)(:\d+)?$/i.exec(rule);
			if (!domain || isIP(domain[1])) return rule;
			const [, hostname, port = ""] = domain;
			// Chromium uses separate rules for the domain itself and its subdomains.
			return [`${hostname}${port}`, `.${hostname}${port}`];
		})
		.join(",");
}

function proxyForCaptionDownloads(): Promise<CaptionProxy> | undefined {
	const env = process.env;
	const address = [
		env.https_proxy,
		env.HTTPS_PROXY,
		env.http_proxy,
		env.HTTP_PROXY,
		env.all_proxy,
		env.ALL_PROXY,
	]
		.find((value) => value?.trim())
		?.trim();
	const bypassRules = chromiumBypassRules(env.no_proxy ?? env.NO_PROXY);
	const configuration = bypassRules?.split(",").includes("*")
		? configureDirectDownload
		: address
			? () => configureProxy(address, bypassRules)
			: undefined;
	if (!configuration) return;
	configuredProxy ??= configuration().catch((error) => {
		configuredProxy = undefined;
		throw error;
	});
	return configuredProxy;
}

async function configureDirectDownload(): Promise<CaptionProxy> {
	const downloadSession = session.fromPartition("recordly-caption-downloads", { cache: false });
	await downloadSession.setProxy({ mode: "direct" });
	return { session: downloadSession };
}

async function configureProxy(address: string, bypassRules?: string): Promise<CaptionProxy> {
	let proxy: URL;
	try {
		proxy = new URL(address.includes("://") ? address : `http://${address}`);
	} catch {
		throw new Error("The caption download proxy address is invalid.");
	}
	// Chromium's SOCKS5 transport already resolves hostnames at the proxy.
	const protocol = proxy.protocol === "socks5h:" ? "socks5:" : proxy.protocol;
	const defaultPort = PROXY_DEFAULT_PORTS.get(protocol);
	if (!defaultPort || !proxy.hostname) {
		throw new Error("The caption download proxy type is unsupported.");
	}
	const downloadSession = session.fromPartition("recordly-caption-downloads", { cache: false });
	await downloadSession.setProxy({
		mode: "fixed_servers",
		proxyRules: `${protocol}//${proxy.host}`,
		proxyBypassRules: bypassRules,
	});
	return {
		session: downloadSession,
		credentials: {
			host: proxy.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
			port: Number(proxy.port || defaultPort),
			username: decodeURIComponent(proxy.username),
			password: decodeURIComponent(proxy.password),
		},
	};
}

export async function receiveCaptionDownload(
	url: string,
	maxRedirects: number,
	consume: (response: DownloadResponse) => Promise<void>,
): Promise<void> {
	if (new URL(url).protocol !== "https:")
		throw new Error("Caption model downloads require HTTPS.");
	const proxy = await proxyForCaptionDownloads();
	const request = net.request({ url, redirect: "manual", session: proxy?.session });
	const credentials = proxy?.credentials;
	if (credentials && (credentials.username || credentials.password)) {
		let sentCredentials = false;
		request.on("login", (auth, reply) => {
			const host = auth.host.replace(/^\[|\]$/g, "").toLowerCase();
			if (
				!auth.isProxy ||
				sentCredentials ||
				host !== credentials.host ||
				auth.port !== credentials.port
			) {
				reply();
				return;
			}
			sentCredentials = true;
			reply(credentials.username, credentials.password);
		});
	}

	let response: DownloadResponse | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let redirects = 0;
	try {
		await new Promise<void>((resolve, reject) => {
			const fail = (error: Error) => {
				if (response) response.destroy(error);
				else reject(error);
			};
			timer = setTimeout(
				() => fail(new Error("Caption model download timed out.")),
				IDLE_TIMEOUT_MS,
			);
			const resetTimer = () => timer?.refresh();
			request.on("error", fail);
			request.on("redirect", (_status, _method, redirectUrl) => {
				if (new URL(redirectUrl).protocol !== "https:") {
					fail(new Error("Caption model downloads require HTTPS."));
					return;
				}
				if (++redirects > maxRedirects) {
					fail(new Error("Too many redirects downloading the caption model."));
					return;
				}
				resetTimer();
				request.followRedirect();
			});
			request.once("response", (message) => {
				const incoming = message as DownloadResponse;
				response = incoming;
				resetTimer();
				incoming.on("aborted", () =>
					incoming.destroy(new Error("Caption model download interrupted.")),
				);
				void consume(incoming).then(resolve, reject);
				incoming.on("data", resetTimer);
			});
			request.end();
		});
	} catch (error) {
		response?.destroy();
		request.abort();
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
