import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeResponse = { status: number; chunks: string[] };
type FakeLogin = { isProxy: boolean; callback: ReturnType<typeof vi.fn>; times?: number };

const electronMocks = vi.hoisted(() => {
	const state: { response: FakeResponse; login: FakeLogin | null } = {
		response: { status: 200, chunks: [] },
		login: null,
	};
	const defaultSession = { name: "default" };
	const setProxy = vi.fn(async () => undefined);
	const proxySession = { name: "proxy", setProxy };
	const fromPartition = vi.fn(() => proxySession);
	const request = vi.fn();
	return { state, defaultSession, proxySession, setProxy, fromPartition, request };
});

vi.mock("electron", () => ({
	net: { request: electronMocks.request },
	session: {
		defaultSession: electronMocks.defaultSession,
		fromPartition: electronMocks.fromPartition,
	},
}));
vi.mock("../constants", () => ({
	WHISPER_MODEL_DIR: "/tmp/whisper",
	WHISPER_MODEL_DOWNLOAD_URL: "https://example.com/ggml-small.bin",
	WHISPER_SMALL_MODEL_PATH: "/tmp/whisper/ggml-small.bin",
}));

import { downloadFileWithProgress, getProxyFromEnv } from "./whisper";

const PROXY_ENV_KEYS = [
	"HTTPS_PROXY",
	"https_proxy",
	"HTTP_PROXY",
	"http_proxy",
	"ALL_PROXY",
	"all_proxy",
	"NO_PROXY",
	"no_proxy",
];

// Mimics Electron's ClientRequest: optionally asks for credentials, then responds.
function createFakeRequest() {
	const request = Object.assign(new EventEmitter(), {
		abort: vi.fn(),
		end: vi.fn(() => {
			setImmediate(() => {
				const { login, response } = electronMocks.state;
				for (let attempt = 0; login && attempt < (login.times ?? 1); attempt++) {
					request.emit("login", { isProxy: login.isProxy }, login.callback);
				}
				const totalBytes = response.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
				const incoming = Object.assign(
					Readable.from(response.chunks.map((c) => Buffer.from(c))),
					{
						statusCode: response.status,
						headers: { "content-length": String(totalBytes) },
					},
				);
				request.emit("response", incoming);
			});
		}),
	});
	return request;
}

describe("getProxyFromEnv", () => {
	it("returns null when no proxy is configured", () => {
		expect(getProxyFromEnv({})).toBeNull();
		expect(getProxyFromEnv({ HTTPS_PROXY: "  " })).toBeNull();
	});

	it("prefers HTTPS_PROXY and accepts lowercase variables", () => {
		expect(
			getProxyFromEnv({
				HTTP_PROXY: "http://http-proxy:3128",
				HTTPS_PROXY: "http://https-proxy:3128",
			}),
		).toEqual({ config: { proxyRules: "http://https-proxy:3128" }, credentials: null });
		expect(getProxyFromEnv({ http_proxy: "http://127.0.0.1:7890" })?.config).toEqual({
			proxyRules: "http://127.0.0.1:7890",
		});
	});

	it("passes NO_PROXY through as bypass rules, skipping empty values", () => {
		expect(
			getProxyFromEnv({ ALL_PROXY: "socks5://127.0.0.1:1080", NO_PROXY: "localhost,.lan" })
				?.config,
		).toEqual({ proxyRules: "socks5://127.0.0.1:1080", proxyBypassRules: "localhost,.lan" });
		expect(
			getProxyFromEnv({
				HTTPS_PROXY: "http://proxy:3128",
				NO_PROXY: "",
				no_proxy: "localhost",
			})?.config,
		).toEqual({ proxyRules: "http://proxy:3128", proxyBypassRules: "localhost" });
	});

	it("moves credentials out of the proxy URL", () => {
		expect(getProxyFromEnv({ HTTPS_PROXY: "http://us%40er:p%3Ass@proxy.local:3128" })).toEqual({
			config: { proxyRules: "http://proxy.local:3128" },
			credentials: { username: "us@er", password: "p:ss" },
		});
	});
});

describe("downloadFileWithProgress", () => {
	let tempRoot: string;
	let savedEnv: Record<string, string | undefined>;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-whisper-download-"));
		savedEnv = Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
		for (const key of PROXY_ENV_KEYS) {
			delete process.env[key];
		}
		vi.clearAllMocks();
		electronMocks.state.login = null;
		electronMocks.request.mockImplementation(() => createFakeRequest());
	});

	afterEach(async () => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("downloads through Electron's default session so system proxy settings apply", async () => {
		electronMocks.state.response = { status: 200, chunks: ["ab", "cd", "ef", "gh"] };
		const destinationPath = path.join(tempRoot, "model.bin");
		const progress: number[] = [];

		await downloadFileWithProgress("https://example.com/model", destinationPath, (value) =>
			progress.push(value),
		);

		expect(electronMocks.request).toHaveBeenCalledWith({
			url: "https://example.com/model",
			session: electronMocks.defaultSession,
		});
		expect(electronMocks.fromPartition).not.toHaveBeenCalled();
		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("abcdefgh");
		// Streams may merge chunks, so only check the progress contract.
		expect(progress.at(-1)).toBe(100);
		expect(progress).toEqual([...progress].sort((a, b) => a - b));
		expect(new Set(progress).size).toBe(progress.length);
	});

	it("uses the proxy from the environment and answers its login with the URL credentials", async () => {
		process.env.HTTPS_PROXY = "http://user:secret@127.0.0.1:8899";
		electronMocks.state.response = { status: 200, chunks: ["model"] };
		electronMocks.state.login = { isProxy: true, callback: vi.fn() };
		const destinationPath = path.join(tempRoot, "model.bin");

		await downloadFileWithProgress(
			"https://example.com/model",
			destinationPath,
			() => undefined,
		);

		expect(electronMocks.setProxy).toHaveBeenCalledWith({
			proxyRules: "http://127.0.0.1:8899",
		});
		expect(electronMocks.request).toHaveBeenCalledWith({
			url: "https://example.com/model",
			session: electronMocks.proxySession,
		});
		expect(electronMocks.state.login.callback).toHaveBeenCalledWith("user", "secret");
		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("model");
	});

	it("sends proxy credentials only once, so rejected credentials cannot loop", async () => {
		process.env.HTTPS_PROXY = "http://user:wrong@127.0.0.1:8899";
		electronMocks.state.response = { status: 407, chunks: [] };
		electronMocks.state.login = { isProxy: true, callback: vi.fn(), times: 2 };

		await expect(
			downloadFileWithProgress(
				"https://example.com/model",
				path.join(tempRoot, "model.bin"),
				() => undefined,
			),
		).rejects.toThrow("Whisper model download failed with status 407.");
		expect(electronMocks.state.login.callback.mock.calls).toEqual([["user", "wrong"], []]);
	});

	it("does not send proxy credentials to a server login", async () => {
		process.env.HTTPS_PROXY = "http://user:secret@127.0.0.1:8899";
		electronMocks.state.response = { status: 200, chunks: ["model"] };
		electronMocks.state.login = { isProxy: false, callback: vi.fn() };

		await downloadFileWithProgress(
			"https://example.com/model",
			path.join(tempRoot, "model.bin"),
			() => undefined,
		);

		expect(electronMocks.state.login.callback).toHaveBeenCalledWith();
	});

	it("rejects when the server does not return the file", async () => {
		electronMocks.state.response = { status: 404, chunks: ["Not Found"] };

		await expect(
			downloadFileWithProgress(
				"https://example.com/model",
				path.join(tempRoot, "model.bin"),
				() => undefined,
			),
		).rejects.toThrow("Whisper model download failed with status 404.");
	});
});
