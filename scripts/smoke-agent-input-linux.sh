#!/usr/bin/env bash
set -euo pipefail

APT_DEPS="build-essential libx11-dev libxtst-dev libxi-dev xvfb xauth dbus at-spi2-core openbox python3 python3-gi gir1.2-gtk-3.0 xdotool fonts-dejavu-core"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -m)" in
x86_64) ARCH=x64 ;;
aarch64 | arm64) ARCH=arm64 ;;
*)
	echo "Unsupported architecture: $(uname -m)" >&2
	exit 1
	;;
esac
HELPER="$ROOT/electron/native/bin/linux-$ARCH/recordly-agent-input"
if [ ! -x "$HELPER" ]; then
	echo "Missing $HELPER. Install $APT_DEPS, then run node scripts/build-native-helpers.mjs." >&2
	exit 1
fi
for tool in xvfb-run dbus-run-session openbox xdotool python3; do
	command -v "$tool" >/dev/null || {
		echo "Missing $tool. Install: $APT_DEPS" >&2
		exit 1
	}
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat >"$WORK/app.py" <<'PY'
import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
gi.require_version("GdkX11", "3.0")
from gi.repository import Gdk, GdkX11, GLib, Gtk  # noqa: E402,F401


def log(text):
    print(text, flush=True)


def ctrl(event):
    return int(bool(event.state & Gdk.ModifierType.CONTROL_MASK))


main = Gtk.Window(title="Recordly Smoke")
main.set_default_size(520, 460)
main.move(80, 60)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, margin=8)
button = Gtk.Button(label="Press Me")
button.connect("clicked", lambda *_: log("clicked"))
entry = Gtk.Entry()
entry.set_placeholder_text("Type here")
entry.connect("changed", lambda e: log("text=" + e.get_text()))
target = Gtk.EventBox()
target.add(Gtk.Label(label="Click Target"))
target.set_size_request(-1, 48)
clicks = {4: 1, 5: 2, 6: 3}
target.connect("button-press-event", lambda w, e: log(f"press n={clicks.get(int(e.type), 0)} button={e.button} ctrl={ctrl(e)}") or False)
target.connect("button-release-event", lambda w, e: log(f"release button={e.button}") or False)
scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1)
scale.connect("value-changed", lambda s: log(f"scale={s.get_value():.0f}"))
layout = Gtk.Layout()
layout.set_size(400, 200)
layout.put(Gtk.Button(label="Hidden Below"), 10, 120)
pane = Gtk.ScrolledWindow()
pane.set_size_request(-1, 50)
pane.add(layout)
rows = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
for i in range(60):
    rows.pack_start(Gtk.Label(label=f"Row {i}"), False, False, 0)
rows.pack_start(Gtk.Button(label="Far Away"), False, False, 0)
scrolled = Gtk.ScrolledWindow()
scrolled.set_min_content_height(150)
scrolled.add(rows)
scrolled.get_vadjustment().connect("value-changed", lambda a: log(f"scroll={a.get_value():.0f}"))
for widget in (button, entry, target, scale, pane):
    box.pack_start(widget, False, False, 0)
box.pack_start(scrolled, True, True, 0)
main.add(box)
main.connect("key-press-event", lambda w, e: log(f"key={Gdk.keyval_name(e.keyval)} ctrl={ctrl(e)}") or False)
main.connect("key-release-event", lambda w, e: log(f"keyup={Gdk.keyval_name(e.keyval)}") or False)
main.connect("destroy", Gtk.main_quit)
other = Gtk.Window(title="Other Window")
other.set_default_size(300, 200)
other.move(760, 420)
other.add(Gtk.Label(label="Other"))
main.show_all()
other.show_all()
GLib.timeout_add(800, lambda: log(f"ready main={main.get_window().get_xid()} other={other.get_window().get_xid()}") or False)
Gtk.main()
PY

cat >"$WORK/smoke.py" <<'PY'
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

helper_path, app_path = sys.argv[1], sys.argv[2]
WAYLAND = "Mouse and keyboard control needs an X11 session on Linux; Wayland is not supported yet."
failures = []


def check(ok, label, detail=None):
    print(("PASS " if ok else "FAIL ") + label + ("" if ok or detail is None else f" -> {detail}"), flush=True)
    if not ok:
        failures.append(label)
    return ok


class Lines:
    def __init__(self, stream, parse):
        self.items = []
        self.cond = threading.Condition()

        def run():
            for line in stream:
                line = line.rstrip("\n")
                try:
                    item = json.loads(line) if parse else line
                except ValueError:
                    item = {"unparsed": line}
                with self.cond:
                    self.items.append(item)
                    self.cond.notify_all()

        threading.Thread(target=run, daemon=True).start()

    def count(self):
        with self.cond:
            return len(self.items)

    def wait(self, pred, timeout=10, start=0):
        deadline = time.time() + timeout
        with self.cond:
            while True:
                for i in range(start, len(self.items)):
                    if pred(self.items[i]):
                        return i, self.items[i]
                left = deadline - time.time()
                if left <= 0:
                    return None, None
                self.cond.wait(left)


class Helper:
    def __init__(self, env=None):
        self.proc = subprocess.Popen(
            [helper_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env
        )
        self.out = Lines(self.proc.stdout, True)
        self.next = 0

    def send(self, cmd, **fields):
        self.next += 1
        self.proc.stdin.write(json.dumps({"cmd": cmd, "id": self.next, **fields}) + "\n")
        self.proc.stdin.flush()
        return self.next

    def result(self, rid, timeout=15):
        return self.out.wait(lambda m: m.get("id") == rid, timeout)[1] or {"ok": False, "error": "no reply"}

    def call(self, cmd, timeout=15, **fields):
        return self.result(self.send(cmd, **fields), timeout)

    def events(self, start=0):
        return [m for m in self.out.items[start:] if "event" in m]


def center(element):
    return element["x"] + element["width"] / 2, element["y"] + element["height"] / 2


def xdotool(*args):
    subprocess.run(["xdotool", *args], check=True)


wm = subprocess.Popen(["openbox", "--sm-disable"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
h = Helper()
pf = h.call("preflight")
check(
    pf.get("ok") and pf.get("postEvents") and pf.get("x11") and pf.get("xtest") and pf.get("xinput2")
    and pf.get("atspi") and pf.get("accessibility") and pf.get("wayland") is False,
    "preflight reports X11, XTest, XInput2 and AT-SPI",
    pf,
)
check(h.call("nope").get("error") == "unknown command: nope", "unknown command is refused")
h.proc.stdin.write("{not json\n")
h.proc.stdin.flush()
check(h.out.wait(lambda m: m.get("id") is None and m.get("error") == "invalid request", 5)[1] is not None, "invalid JSON is refused")
check(h.call("move", x=10, y=10, ms=0).get("error") == "user-input", "input is refused until armed")

app = subprocess.Popen([sys.executable, app_path], stdout=subprocess.PIPE, text=True)
app_out = Lines(app.stdout, False)
_, ready = app_out.wait(lambda line: line.startswith("ready "), 30)
if not ready:
    print("FAIL GTK test window did not start", flush=True)
    sys.exit(1)
ids = dict(part.split("=") for part in ready.split()[1:])
main_id, other_id = int(ids["main"]), int(ids["other"])


def front(want, timeout=5):
    deadline = time.time() + timeout
    while True:
        window = h.call("frontmost_window").get("window")
        if (window and window["windowId"] == want) or time.time() > deadline:
            return window
        time.sleep(0.1)


def app_wait(pred, timeout=5, start=0):
    return app_out.wait(pred, timeout, start)[1]


nowhere = {"x": 0, "y": 0, "width": 1, "height": 1}
window = front(other_id)
check(window is not None and window["windowId"] == other_id, "frontmost_window reports the newest window", window)
r = h.call("raise", pid=app.pid, windowId=main_id, frame=nowhere)
window = front(main_id)
check(
    r.get("raised") is True and window and window["windowId"] == main_id and window["pid"] == app.pid
    and window["title"] == "Recordly Smoke" and window["appName"] and window["bundleId"] is None,
    "raise brings the main window to the front",
    (r, window),
)
frame = {k: window[k] for k in ("x", "y", "width", "height")}
r = h.call("raise", pid=app.pid, windowId=other_id, frame=nowhere)
check(r.get("raised") is True and front(other_id)["windowId"] == other_id, "raise switches to the other window", r)
r = h.call("raise", pid=app.pid, windowId=0, frame=frame)
check(r.get("raised") is True and front(main_id)["windowId"] == main_id, "raise finds a window by pid and frame", r)
check(h.call("raise", pid=999999, windowId=main_id, frame=frame).get("error") == "process 999999 is not running", "raise rejects a dead pid")
info = h.call("window_info", windowId=main_id).get("window")
check(
    info == {"pid": app.pid, "windowId": main_id, "title": "Recordly Smoke", "appName": window["appName"], "frame": frame, "visible": True, "minimized": False},
    "window_info describes a visible window",
    info,
)
xdotool("windowminimize", str(other_id))
deadline = time.time() + 5
while (info := h.call("window_info", windowId=other_id).get("window")) and not info["minimized"] and time.time() < deadline:
    time.sleep(0.1)
check(info and info["windowId"] == other_id and info["minimized"] is True and info["visible"] is False, "window_info reports an iconified window", info)
r = h.call("window_info", windowId=0x7FFFFFF0)
check(r.get("ok") is True and r.get("window") is None and h.call("cursor").get("ok"), "window_info returns null for an unknown XID", r)


def find(**fields):
    return h.call("find", pid=app.pid, windowId=main_id, frame=frame, limit=fields.pop("limit", 50), **fields)


def only(result):
    elements = result.get("elements") or []
    return elements[0] if len(elements) == 1 else None


r = find(text="press me")
button = only(r)
check(r.get("ok") and button and button["role"] == "AXButton" and button["label"] == "Press Me", "find by text returns the button", r)
r = find(role="textbox")
field = only(r)
check(field and field["role"] == "AXTextField" and field["label"] == "Type here", "find by role returns the entry with its placeholder", r)
r = find()
roles = {(e["role"], e["label"]) for e in r.get("elements", [])}
check(("AXButton", "Press Me") in roles and ("AXTextField", "Type here") in roles and ("AXButton", "Far Away") not in roles, "find without filters lists visible controls", r)
r = find(text="far away")
check(r.get("ok") and r.get("elements") == [], "find skips matches outside the window", r)
check(find(text="far away", offscreen=True).get("elements") == [], "find drops scrolled-out GTK widgets, which have no position")
top = dict(frame, height=40)
r = h.call("find", pid=app.pid, windowId=main_id, frame=top, limit=50, text="click target")
check(r.get("ok") and r.get("elements") == [], "find skips matches below a shorter frame", r)
r = h.call("find", pid=app.pid, windowId=main_id, frame=top, limit=50, text="click target", offscreen=True)
below = only(r)
check(below and below.get("visible") is False and below["y"] > top["y"] + top["height"], "find with offscreen returns them with visible false", r)
check("visible" not in (only(find(text="press me", offscreen=True)) or {"visible": 1}), "visible matches carry no visible field")
check(find(text="hidden below").get("elements") == [], "find skips a widget scrolled out of its pane")
r = find(text="hidden below", offscreen=True)
hidden = only(r)
box = (hidden or {}).get("container")
check(
    hidden and hidden.get("visible") is False and box and "web" not in hidden
    and center(hidden)[1] >= box["y"] + box["height"] and center(hidden)[1] < frame["y"] + frame["height"],
    "a widget inside the window but scrolled out of its pane is visible false with its container",
    r,
)
target = only(find(text="click target"))
slider = only(find(role="slider"))
row = only(find(text="row 3", role="text"))
check(target and slider and row and row["role"] == "AXStaticText", "find by AT-SPI role name and alias", (target, slider, row))
check(len(find(text="row", limit=2).get("elements", [])) == 2 and find(text="row", limit=2).get("truncated") is True, "find honours limit and reports truncated")
check(find(role="bogus").get("error") == "unknown role: bogus", "find rejects an unknown role")


def at(x, y, helper=None):
    return (helper or h).call("at", pid=app.pid, x=x, y=y)


r = at(*center(button))
check(
    r.get("ok") and r.get("hit") == {"role": "AXButton", "label": "Press Me", **{k: button[k] for k in ("x", "y", "width", "height")}}
    and r.get("parent") and r["parent"]["width"] > 0,
    "at returns the control under the point with its parent",
    r,
)
r = at(frame["x"] + frame["width"] + 60, frame["y"] + frame["height"] + 60)
check(r.get("ok") is True and r.get("hit") is None and r.get("parent") is None, "at returns nulls over empty space", r)
stub = tempfile.mkdtemp()
with open(os.path.join(stub, "libatspi.so.0"), "w") as handle:
    handle.write("not a library\n")
blind = Helper({**os.environ, "LD_LIBRARY_PATH": stub})
r = at(*center(button), helper=blind)
pf = blind.call("preflight")
check(
    r.get("ok") is True and r.get("hit") is None and r.get("parent") is None and pf.get("atspi") is False
    and blind.call("find", pid=app.pid, windowId=main_id, frame=frame, limit=5).get("error", "").endswith("libatspi (at-spi2-core) is not installed"),
    "at returns nulls when libatspi cannot be loaded",
    (r, pf),
)
blind.proc.stdin.close()
blind.proc.wait(5)
if not (button and field and target and slider and row):
    print("FAIL cannot continue without targets", flush=True)
    sys.exit(1)

check(h.call("arm").get("ok"), "arm")
bx, by = center(button)
check(h.call("move", x=bx, y=by, ms=300).get("ok"), "move")
c = h.call("cursor")
check(abs(c["x"] - round(bx)) <= 1 and abs(c["y"] - round(by)) <= 1, "cursor reports the glide target", c)
mark = app_out.count()
check(h.call("click", x=bx, y=by, ms=200, button="left", count=1, modifiers=[]).get("ok") and app_wait(lambda l: l == "clicked", start=mark), "click presses the button")
fx, fy = center(field)
check(h.call("click", x=fx, y=fy, ms=200, button="left", count=1, modifiers=[]).get("ok"), "click focuses the entry")
mark = app_out.count()
check(h.call("type", text="Hello, World! 123", cps=40, timeout=20).get("ok") and app_wait(lambda l: l == "text=Hello, World! 123", start=mark), "type enters layout characters")
mark = app_out.count()
check(h.call("type", text=" é€ж", cps=20).get("ok") and app_wait(lambda l: l == "text=Hello, World! 123 é€ж", start=mark), "type enters characters missing from the layout")
mark = app_out.count()
check(h.call("key", key="a", modifiers=["ctrl"], repeat=1).get("ok") and app_wait(lambda l: l == "key=a ctrl=1", start=mark), "key with ctrl")
mark = app_out.count()
check(h.call("key", key="backspace", modifiers=[], repeat=1).get("ok") and app_wait(lambda l: l == "text=", start=mark), "ctrl+a then backspace clears the entry")
mark = app_out.count()
check(h.call("key", key="?", modifiers=[], repeat=1).get("ok") and app_wait(lambda l: l == "text=?", start=mark), "a shifted single character key")
h.call("type", text="abc", cps=40)
mark = app_out.count()
check(h.call("key", key="backspace", modifiers=[], repeat=2).get("ok") and app_wait(lambda l: l == "text=?a", start=mark), "key repeat")
check(h.call("key", key="ж", modifiers=["ctrl"], repeat=1).get("error", "").startswith("ж is not a single key on the current keyboard layout"), "a character off the layout cannot take modifiers")
check(h.call("key", key="bogus", modifiers=[], repeat=1).get("error", "").startswith("unknown key: bogus"), "unknown key is refused")
check(h.call("click", x=1, y=1, ms=0, button="left", count=4, modifiers=[]).get("error") == "count must be a whole number from 1 to 3", "click count is validated")
check(h.call("click", x=1, y=1, ms=0, button="left", count=1, modifiers=["hyper"]).get("error", "").startswith("unknown modifier: hyper"), "unknown modifier is refused")

rx, ry = center(row)
mark = app_out.count()
check(h.call("scroll", x=rx, y=ry, ms=300, dx=0, dy=300, modifiers=[]).get("ok") and app_wait(lambda l: l.startswith("scroll=") and int(l[7:]) > 100, start=mark), "scroll down moves the list")
mark = app_out.count()
check(h.call("scroll", x=rx, y=ry, ms=300, dx=0, dy=-2000, modifiers=[]).get("ok") and app_wait(lambda l: l == "scroll=0", start=mark), "scroll up returns to the top")

tx, ty = center(target)
mark = app_out.count()
check(h.call("click", x=tx, y=ty, ms=200, button="left", count=3, modifiers=[]).get("ok") and app_wait(lambda l: l == "press n=3 button=1 ctrl=0", start=mark), "triple click")
mark = app_out.count()
check(h.call("click", x=tx, y=ty, ms=0, button="right", count=1, modifiers=["ctrl"]).get("ok") and app_wait(lambda l: l == "press n=1 button=3 ctrl=1", start=mark), "right click with ctrl")
mark = app_out.count()
r = h.call("drag", fromX=slider["x"] + 6, fromY=center(slider)[1], toX=slider["x"] + slider["width"] - 2, toY=center(slider)[1], ms=400, button="left", modifiers=[])
check(r.get("ok") and app_wait(lambda l: l.startswith("scale=") and int(l[6:]) >= 90, start=mark), "drag moves the slider", r)
check(h.events() == [], "Recordly's own input never reads as a takeover", h.events())

mark = h.out.count()
rid = h.send("move", x=bx + 250, y=by + 200, ms=3000)
time.sleep(0.5)
xdotool("mousemove_relative", "200", "150")
res = h.result(rid, 10)
res_i = h.out.items.index(res) if res in h.out.items else None
ev_i, ev = h.out.wait(lambda m: m.get("event") == "user-input", 1, mark)
check(res.get("error") == "user-input" and ev and ev["kind"] == "move" and ev["escape"] is False and ev_i < res_i, "a user move aborts the glide and the event comes first", (ev, res))
check(h.call("move", x=bx, y=by, ms=0).get("error") == "user-input", "input stays refused after a takeover until re-armed")

h.call("arm")
c = h.call("cursor")
mark = h.out.count()
xdotool("mousemove_relative", "3", "0")
time.sleep(0.4)
check(h.events(mark) == [] and h.call("move", x=bx, y=by, ms=100).get("ok"), "a few pixels of drift are ignored", h.events(mark))
for label, args, kind, escape in [
    ("Esc", ("key", "Escape"), "key", True),
    ("a key", ("key", "x"), "key", False),
    ("a click", ("click", "1"), "button", False),
    ("a wheel", ("click", "5"), "scroll", False),
]:
    h.call("arm")
    mark = h.out.count()
    xdotool(*args)
    _, ev = h.out.wait(lambda m: m.get("event") == "user-input", 3, mark)
    check(ev == {"event": "user-input", "kind": kind, "escape": escape}, f"{label} from another client is a takeover", ev)
check(h.call("disarm").get("ok"), "disarm")

h.call("arm")
mark = app_out.count()
h.send("drag", fromX=tx, fromY=ty, toX=tx + 150, toY=ty, ms=3000, button="left", modifiers=["shift"])
pressed = app_wait(lambda l: l.startswith("press n=1 button=1"), 5, mark)
h.proc.stdin.close()
released = app_wait(lambda l: l == "release button=1", 3, mark)
shift_up = app_wait(lambda l: l == "keyup=Shift_L", 3, mark)
try:
    code = h.proc.wait(5)
except subprocess.TimeoutExpired:
    code = None
check(pressed and released and shift_up and code == 0, "held button and modifier are released when stdin closes", (pressed, released, shift_up, code))

env = {k: v for k, v in os.environ.items() if k != "DISPLAY"}
env.update(XDG_SESSION_TYPE="wayland", WAYLAND_DISPLAY="wayland-0")
w = Helper(env)
pf = w.call("preflight")
check(pf.get("ok") and pf.get("postEvents") is False and pf.get("x11") is False and pf.get("wayland") is True, "preflight on Wayland", pf)
check(w.call("disarm").get("ok"), "disarm still answers on Wayland")
for cmd, fields in [
    ("move", {"x": 1, "y": 1, "ms": 0}),
    ("click", {"x": 1, "y": 1, "ms": 0, "button": "left", "count": 1, "modifiers": []}),
    ("type", {"text": "a", "cps": 15}),
    ("key", {"key": "a", "modifiers": [], "repeat": 1}),
    ("arm", {}),
    ("cursor", {}),
    ("frontmost_window", {}),
    ("raise", {"pid": app.pid, "windowId": main_id, "frame": frame}),
    ("find", {"pid": app.pid, "windowId": main_id, "frame": frame, "limit": 5}),
    ("window_info", {"windowId": main_id}),
    ("at", {"pid": app.pid, "x": 10, "y": 10}),
]:
    r = w.call(cmd, **fields)
    check(r.get("ok") is False and r.get("error") == WAYLAND, f"Wayland refuses {cmd}", r)
w.proc.stdin.close()
w.proc.wait(5)

app.terminate()
wm.terminate()
print(f"{len(failures)} failure(s)" if failures else "All Linux agent input checks passed", flush=True)
sys.exit(1 if failures else 0)
PY

xvfb-run -a -s "-screen 0 1280x800x24" dbus-run-session -- python3 "$WORK/smoke.py" "$HELPER" "$WORK/app.py"
