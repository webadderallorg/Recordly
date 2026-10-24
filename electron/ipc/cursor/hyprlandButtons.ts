import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { getHyprlandRequestSocketPath } from "./hyprland";

const REQUEST_TIMEOUT_MS = 250;
const MAX_RESPONSE_BYTES = 4096;
const HEARTBEAT_MS = 1000;
const REGISTRY = "__recordly_button_capture_v1";
const requestQueues = new Map<string, Promise<boolean>>();

type ButtonHandlers = {
	onMouseDown: (button: 1 | 2 | 3) => void;
	onMouseUp: () => void;
};

// Hyprland 0.55/0.56 remove() also removes the user's matching binds.
// Keep six disabled handles for reuse until reload; a compositor timer expires
// the lease even if Recordly crashes or cannot send its cleanup request.
export function buildHyprlandButtonCommand(action: "start" | "renew" | "stop", token: string) {
	if (!/^[a-zA-Z0-9-]+$/.test(token)) throw new Error("Invalid capture token");
	const state = `local s = rawget(_G, "${REGISTRY}")`;
	if (action === "stop") {
		return `eval ${state}; if s and s.token == "${token}" then s.stop() end`;
	}
	if (action === "renew") {
		return `eval ${state}; assert(s and s.token == "${token}", "capture lease lost"); s.timer:set_timeout(5000)`;
	}
	return `eval assert(type(hl) == "table" and type(hl.version) == "function" and type(hl.bind) == "function" and type(hl.timer) == "function" and type(hl.dispatch) == "function" and type(hl.dsp) == "table" and type(hl.dsp.event) == "function", "capture capabilities unavailable")
local version = hl.version()
local major, minor = tostring(version):match("^v?(%d+)%.(%d+)%.%d+")
assert(major and (tonumber(major) > 0 or tonumber(minor) >= 55), "capture requires Hyprland 0.55 or newer")
${state}
assert(s == nil or (type(s) == "table" and s.schema == "recordly-1"), "capture registry conflict")
if not s then
  s = {schema = "recordly-1", binds = {}}
  rawset(_G, "${REGISTRY}", s)
  s.stop = function()
    s.token = nil
    for _, bind in pairs(s.binds) do bind:set_enabled(false) end
    if s.timer then s.timer:set_enabled(false) end
  end
end
assert(not s.token or s.token == "${token}", "capture already in use")
local ok, err = pcall(function()
  if not s.timer then
    s.timer = hl.timer(function() s.stop() end, {timeout = 5000, type = "repeat"})
    assert(s.timer and type(s.timer.set_enabled) == "function" and type(s.timer.set_timeout) == "function", "capture timer unavailable")
    s.timer:set_enabled(false)
  end
  for button = 1, 3 do
    for release = 0, 1 do
      local index = (button - 1) * 2 + release + 1
      if not s.binds[index] then
        local suffix = (release == 0 and "-down-" or "-up-") .. button
        local bind = hl.bind("mouse:" .. (271 + button), function()
          if s.token then hl.dispatch(hl.dsp.event(s.token .. suffix)) end
        end, {non_consuming = true, release = release == 1, ignore_mods = true, transparent = true, submap_universal = true})
        assert(bind and type(bind.set_enabled) == "function", "capture bind unavailable")
        s.binds[index] = bind
        bind:set_enabled(false)
      end
    end
  end
  s.token = "${token}"
  s.timer:set_timeout(5000)
  for _, bind in pairs(s.binds) do bind:set_enabled(true) end
end)
if not ok then s.stop(); error(err) end
`;
}

export function requestHyprlandCommand(socketPath: string, command: string): Promise<boolean> {
	return new Promise((resolve) => {
		let output = "";
		let settled = false;
		const socket = net.createConnection(socketPath);
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(ok);
		};
		socket.setEncoding("utf8");
		socket.setTimeout(REQUEST_TIMEOUT_MS, () => finish(false));
		socket.once("connect", () => socket.end(command));
		socket.on("data", (chunk: string) => {
			output += chunk;
			if (Buffer.byteLength(output) > MAX_RESPONSE_BYTES) finish(false);
		});
		socket.once("end", () => finish(output.trim() === "ok"));
		socket.once("error", () => finish(false));
		socket.once("close", () => finish(false));
	});
}

export async function startHyprlandButtonCapture(
	handlers: ButtonHandlers,
	options?: {
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
		signal?: AbortSignal;
		onUnavailable?: () => void;
		request?: typeof requestHyprlandCommand;
		connect?: typeof net.createConnection;
	},
): Promise<{ available: boolean; stop: () => void }> {
	const requestPath = getHyprlandRequestSocketPath(
		options?.env ?? process.env,
		options?.platform ?? process.platform,
	);
	if (!requestPath || options?.signal?.aborted) {
		return { available: false, stop: () => undefined };
	}
	const request = options?.request ?? requestHyprlandCommand;
	const token = `recordly-${randomUUID()}`;
	const socket = (options?.connect ?? net.createConnection)(
		path.join(path.dirname(requestPath), ".socket2.sock"),
	);
	let stopped = false;
	let active = false;
	let ready = false;
	let refreshGeneration = 0;
	let buffered = "";
	let discardingOversizedLine = false;
	let timer: NodeJS.Timeout | null = null;
	const send = (action: "start" | "renew" | "stop") => {
		const pending = (requestQueues.get(requestPath) ?? Promise.resolve(true))
			.then(() =>
				stopped && action !== "stop"
					? false
					: request(requestPath, buildHyprlandButtonCommand(action, token)),
			)
			.catch(() => false);
		requestQueues.set(requestPath, pending);
		void pending.then(() => {
			if (requestQueues.get(requestPath) === pending) requestQueues.delete(requestPath);
		});
		return pending;
	};
	const stop = () => {
		if (stopped) return;
		stopped = true;
		active = false;
		if (timer) clearTimeout(timer);
		options?.signal?.removeEventListener("abort", stop);
		socket.destroy();
		void send("stop");
	};
	const fail = () => {
		if (stopped) return;
		stop();
		if (ready) options?.onUnavailable?.();
	};
	options?.signal?.addEventListener("abort", stop, { once: true });
	socket.setEncoding("utf8");
	const connected = new Promise<boolean>((resolve) => {
		const timeout = setTimeout(() => resolve(false), REQUEST_TIMEOUT_MS);
		const finish = (ok: boolean) => {
			clearTimeout(timeout);
			resolve(ok);
		};
		socket.once("connect", () => finish(true));
		socket.once("close", () => finish(false));
		socket.once("error", () => finish(false));
	});
	socket.on("error", fail);
	socket.on("close", fail);
	const refresh = async (action: "start" | "renew") => {
		const generation = ++refreshGeneration;
		const ok = await send(action);
		if (stopped || generation !== refreshGeneration) return false;
		if (!ok) {
			fail();
			return false;
		}
		active = true;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void refresh("renew"), HEARTBEAT_MS);
		timer.unref();
		return true;
	};
	socket.on("data", (chunk: string) => {
		if (stopped) return;
		if (discardingOversizedLine) {
			const newline = chunk.indexOf("\n");
			if (newline === -1) return;
			chunk = chunk.slice(newline + 1);
			discardingOversizedLine = false;
		}
		buffered += chunk;
		let newline = buffered.indexOf("\n");
		while (newline !== -1) {
			const line = buffered.slice(0, newline);
			buffered = buffered.slice(newline + 1);
			if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES) {
				newline = buffered.indexOf("\n");
				continue;
			}
			if (line === "configreloaded>>") {
				active = false;
				if (timer) clearTimeout(timer);
				void refresh("start");
			} else if (active && line.startsWith(`custom>>${token}-`)) {
				const match = /^(down|up)-([123])$/.exec(line.slice(`custom>>${token}-`.length));
				if (match?.[1] === "down") handlers.onMouseDown(Number(match[2]) as 1 | 2 | 3);
				else if (match?.[1] === "up") handlers.onMouseUp();
			}
			newline = buffered.indexOf("\n");
		}
		if (Buffer.byteLength(buffered) > MAX_RESPONSE_BYTES) {
			buffered = "";
			discardingOversizedLine = true;
		}
	});
	if (!(await connected) || stopped || !(await refresh("start"))) {
		stop();
		return { available: false, stop };
	}
	ready = true;
	return { available: true, stop };
}
