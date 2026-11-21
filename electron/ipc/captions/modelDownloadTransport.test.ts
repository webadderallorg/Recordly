import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	request: vi.fn(),
	fromPartition: vi.fn(),
	setProxy: vi.fn(),
}));

vi.mock("electron", () => ({
	net: { request: mocks.request },
	session: { fromPartition: mocks.fromPartition },
}));

const url = "https://models.test/weights.bin";

function stubRequest() {
	const request = Object.assign(new EventEmitter(), { end: vi.fn(), abort: vi.fn() });
	mocks.request.mockReturnValue(request);
	return request;
}

beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
	for (const name of [
		"HTTPS_PROXY",
		"https_proxy",
		"HTTP_PROXY",
		"http_proxy",
		"ALL_PROXY",
		"all_proxy",
		"NO_PROXY",
		"no_proxy",
	]) {
		vi.stubEnv(name, undefined);
	}
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

it("uses the Electron default session when there is no proxy override", async () => {
	const request = stubRequest();
	const { receiveCaptionDownload } = await import("./modelDownloadTransport");
	const consume = vi.fn(async () => undefined);
	const download = receiveCaptionDownload(url, 5, consume);
	await vi.waitFor(() => expect(request.end).toHaveBeenCalledOnce());
	request.emit("response", Readable.from([]));
	await download;
	expect(mocks.request).toHaveBeenCalledWith({ url, redirect: "manual", session: undefined });
	expect(mocks.fromPartition).not.toHaveBeenCalled();
});

it("applies environment proxy rules and answers only the configured proxy's challenge", async () => {
	vi.stubEnv("HTTPS_PROXY", "http://recordly:local%40test@proxy.test:8899");
	vi.stubEnv(
		"NO_PROXY",
		"example.test, .corp.test:443, 192.168.1.5, 10.0.0.0/8, ::1, *.other.test",
	);
	const downloadSession = { setProxy: mocks.setProxy };
	mocks.fromPartition.mockReturnValue(downloadSession);
	const request = stubRequest();
	const { receiveCaptionDownload } = await import("./modelDownloadTransport");
	const download = receiveCaptionDownload(url, 5, async () => undefined);
	await vi.waitFor(() => expect(request.end).toHaveBeenCalledOnce());
	expect(mocks.setProxy).toHaveBeenCalledWith({
		mode: "fixed_servers",
		proxyRules: "http://proxy.test:8899",
		proxyBypassRules:
			"example.test,.example.test,corp.test:443,.corp.test:443,192.168.1.5,10.0.0.0/8,[::1],*.other.test",
	});
	expect(mocks.request).toHaveBeenCalledWith({
		url,
		redirect: "manual",
		session: downloadSession,
	});
	const reply = vi.fn();
	const challenge = { isProxy: true, host: "proxy.test", port: 8899 };
	request.emit("login", { ...challenge, isProxy: false }, reply);
	request.emit("login", { ...challenge, host: "other-proxy.test" }, reply);
	request.emit("login", challenge, reply);
	request.emit("login", challenge, reply);
	expect(reply.mock.calls).toEqual([[], [], ["recordly", "local@test"], []]);
	request.emit("response", Readable.from([]));
	await download;
});

it("aborts an idle request and rejects the download", async () => {
	vi.useFakeTimers();
	const request = stubRequest();
	const { receiveCaptionDownload } = await import("./modelDownloadTransport");
	const download = receiveCaptionDownload(url, 5, async () => undefined);
	const timeout = expect(download).rejects.toThrow("Caption model download timed out.");
	await vi.advanceTimersByTimeAsync(30_000);
	await timeout;
	expect(request.abort).toHaveBeenCalledOnce();
});
