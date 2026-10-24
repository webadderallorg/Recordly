import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn(() => "/tmp") } }));

import { buildHyprlandButtonCommand } from "./hyprlandButtons";

const lua = spawnSync("lua", ["-v"], { encoding: "utf8" });
const fixture = `
local now, binds, timers, events = 0, {}, {}, {}
local failBind, failTimer
hl = {dsp = {}}
hl.version = function() return "0.56.0" end
hl.dsp.event = function(event) return function() table.insert(events, event) end end
hl.dispatch = function(dispatcher) dispatcher() end
hl.unbind = function() error("unsafe broad unbind") end
hl.bind = function(key, callback, flags)
  if failBind and #binds == failBind then error("bind failure") end
  local bind = {key = key, callback = callback, flags = flags, enabled = true}
  function bind:set_enabled(enabled) self.enabled = enabled end
  function bind:remove() error("unsafe matching-key removal") end
  table.insert(binds, bind)
  return bind
end
hl.timer = function(callback, options)
  if failTimer then error("timer failure") end
  assert(options.type == "repeat")
  local timer = {callback = callback, timeout = options.timeout, deadline = now + options.timeout}
  function timer:set_enabled(enabled)
    self.deadline = enabled and now + self.timeout or nil
  end
  function timer:set_timeout(timeout)
    self.timeout = timeout
    self.deadline = now + timeout
  end
  table.insert(timers, timer)
  return timer
end
local function advance(ms)
  now = now + ms
  for _, timer in ipairs(timers) do
    if timer.deadline and timer.deadline <= now then
      timer.deadline = now + timer.timeout
      timer.callback()
    end
  end
end
local function click(key, release)
  for _, bind in ipairs(binds) do
    if bind.enabled and bind.key == key and (bind.flags.release or false) == release then
      bind.callback()
    end
  end
end
local function captureDisabled()
  local state = rawget(_G, "__recordly_button_capture_v1")
  assert(state.token == nil)
  for _, bind in pairs(state.binds) do assert(not bind.enabled) end
  assert(not state.timer or state.timer.deadline == nil)
end
`;

function command(action: "start" | "renew" | "stop", token = "recordly-test") {
	return buildHyprlandButtonCommand(action, token).slice("eval ".length);
}

function runLua(script: string) {
	const result = spawnSync("lua", ["-"], {
		input: `${fixture}\n${script}`,
		encoding: "utf8",
		timeout: 5000,
	});
	expect(result.error).toBeUndefined();
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
}

describe.skipIf(lua.error || lua.status !== 0)("Hyprland capture Lua lifecycle", () => {
	it("preserves user bindings and reuses exactly six handles across recordings", () => {
		runLua(`
local userClicks = 0
local userBind = hl.bind("mouse:272", function() userClicks = userClicks + 1 end, {})
${command("start")}
assert(#binds == 7 and #timers == 1)
for index = 2, 7 do
  local flags = binds[index].flags
  assert(flags.non_consuming and flags.ignore_mods and flags.transparent and flags.submap_universal)
end
click("mouse:272", false)
click("mouse:272", true)
assert(userClicks == 1)
assert(events[1] == "recordly-test-down-1" and events[2] == "recordly-test-up-1")
${command("stop")}
captureDisabled()
assert(userBind.enabled)
click("mouse:272", false)
assert(userClicks == 2 and #events == 2)
${command("start", "recordly-second")}
assert(#binds == 7 and #timers == 1)
click("mouse:274", false)
assert(events[3] == "recordly-second-down-3")
${command("stop", "recordly-test")}
assert(__recordly_button_capture_v1.token == "recordly-second")
${command("stop", "recordly-second")}
captureDisabled()
`);
	});

	it("expires the compositor lease after a crash and renews from the last heartbeat", () => {
		runLua(`
${command("start")}
advance(4000)
${command("renew")}
advance(4000)
click("mouse:273", false)
assert(events[1] == "recordly-test-down-2")
advance(1000)
captureDisabled()
click("mouse:273", false)
assert(#events == 1)
${command("start", "recordly-restarted")}
assert(#binds == 6 and #timers == 1)
advance(5000)
captureDisabled()
`);
	});

	it("handles an actual reload and a failed reload without duplicate binds", () => {
		runLua(`
${command("start")}
${command("start")}
assert(#binds == 6 and #timers == 1)
binds, timers = {}, {}
rawset(_G, "__recordly_button_capture_v1", nil)
${command("start")}
assert(#binds == 6 and #timers == 1)
click("mouse:272", false)
assert(#events == 1)
${command("stop")}
captureDisabled()
`);
	});

	it("rejects another owner and foreign registries without changing their state", () => {
		runLua(`
${command("start")}
local ok = pcall(function() ${command("start", "recordly-other")} end)
assert(not ok and __recordly_button_capture_v1.token == "recordly-test")
assert(#binds == 6)
rawset(_G, "__recordly_button_capture_v1", {schema = "foreign", token = "keep"})
ok = pcall(function() ${command("start")} end)
assert(not ok and __recordly_button_capture_v1.token == "keep")
assert(#binds == 6)
`);
	});

	it("disables partial registrations and retries without growing the handle pool", () => {
		runLua(`
failBind = 3
local ok = pcall(function() ${command("start")} end)
assert(not ok and #binds == 3)
captureDisabled()
failBind = nil
${command("start")}
assert(#binds == 6 and #timers == 1)
${command("stop")}
captureDisabled()
`);
	});

	it("rejects absent capabilities before installing binds and recovers timer failures", () => {
		runLua(`
local timerFn = hl.timer
hl.timer = nil
local ok = pcall(function() ${command("start")} end)
assert(not ok and #binds == 0 and __recordly_button_capture_v1 == nil)
hl.timer = timerFn
failTimer = true
ok = pcall(function() ${command("start")} end)
assert(not ok and #binds == 0)
captureDisabled()
failTimer = false
${command("start")}
assert(#binds == 6 and #timers == 1)
${command("stop")}
captureDisabled()
`);
	});

	it.each([
		"0.54.3",
		"0.4.0",
		"unknown",
		"",
		"broken.55.0",
	])("rejects unsupported version %s before creating bindings", (version) => {
		runLua(`
hl.version = function() return ${JSON.stringify(version)} end
local ok = pcall(function() ${command("start")} end)
assert(not ok and #binds == 0 and #timers == 0)
assert(__recordly_button_capture_v1 == nil)
`);
	});
});
