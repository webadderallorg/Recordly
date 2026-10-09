// Windows port of electron/native/AgentInput.swift: the same JSON-lines protocol on stdin/stdout.
// All coordinates (input points, frames, element and window bounds, cursor) are global physical
// pixels; the process is per-monitor DPI aware (V2), so Win32 and UI Automation report them unscaled.

#include <windows.h>
#include <dwmapi.h>
#include <mmsystem.h>
#include <oleacc.h>
#include <uiautomation.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cctype>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cwctype>
#include <deque>
#include <functional>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

constexpr ULONG_PTR kAgentTag = 0x52434459;
constexpr double kDriftWindow = 1;
constexpr WORD kMaskKey = 0xE8;  // unassigned; tapped before Alt/Win go up so no menu or Start opens
constexpr double kWheelPerPixel = 120.0 / 100.0;  // Chromium scrolls 100 px per 120-unit notch
constexpr int kHeadingLevelNone = 80050;
constexpr int kHeadingLevel9 = 80059;
constexpr int kHeadingRole = -1;
constexpr int kMatchSubstring = 0x2;  // PropertyConditionFlags_MatchSubstring, missing from older SDK headers

double driftLimit = 8;

struct Failure {
	std::string message;
};

double uptime() {
	return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

std::wstring widen(const std::string& text) {
	if (text.empty()) return {};
	const int length = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
	std::wstring wide(static_cast<size_t>(length), L'\0');
	MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), wide.data(), length);
	return wide;
}

std::string narrow(const std::wstring& text) {
	if (text.empty()) return {};
	const int length = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
	std::string utf8(static_cast<size_t>(length), '\0');
	WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), utf8.data(), length, nullptr, nullptr);
	return utf8;
}

std::wstring trim(const std::wstring& text) {
	const wchar_t* space = L" \t\r\n\v\f ";
	const size_t first = text.find_first_not_of(space);
	if (first == std::wstring::npos) return {};
	return text.substr(first, text.find_last_not_of(space) - first + 1);
}

std::wstring lowercase(std::wstring text) {
	if (!text.empty()) CharLowerBuffW(text.data(), static_cast<DWORD>(text.size()));
	return text;
}

// ---- JSON ---------------------------------------------------------------------------------------

struct Json {
	enum Kind { Null, Bool, Number, String, Array, Object } kind = Null;
	bool boolean = false;
	double number = 0;
	std::string text;
	std::vector<Json> items;
	std::vector<std::pair<std::string, Json>> fields;

	const Json* operator[](const char* key) const {
		if (kind != Object) return nullptr;
		for (const auto& field : fields) {
			if (field.first == key) return &field.second;
		}
		return nullptr;
	}
};

struct JsonParser {
	const char* p;
	const char* end;

	void space() {
		while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) ++p;
	}

	bool literal(const char* word) {
		const size_t length = std::strlen(word);
		if (static_cast<size_t>(end - p) < length || std::memcmp(p, word, length) != 0) return false;
		p += length;
		return true;
	}

	bool hex4(uint32_t& value) {
		if (end - p < 4) return false;
		value = 0;
		for (int i = 0; i < 4; ++i) {
			const char c = *p++;
			value <<= 4;
			if (c >= '0' && c <= '9') value |= static_cast<uint32_t>(c - '0');
			else if (c >= 'a' && c <= 'f') value |= static_cast<uint32_t>(c - 'a' + 10);
			else if (c >= 'A' && c <= 'F') value |= static_cast<uint32_t>(c - 'A' + 10);
			else return false;
		}
		return true;
	}

	static void append(std::string& out, uint32_t code) {
		if (code < 0x80) {
			out += static_cast<char>(code);
		} else if (code < 0x800) {
			out += static_cast<char>(0xC0 | (code >> 6));
			out += static_cast<char>(0x80 | (code & 0x3F));
		} else if (code < 0x10000) {
			out += static_cast<char>(0xE0 | (code >> 12));
			out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
			out += static_cast<char>(0x80 | (code & 0x3F));
		} else {
			out += static_cast<char>(0xF0 | (code >> 18));
			out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
			out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
			out += static_cast<char>(0x80 | (code & 0x3F));
		}
	}

	bool string(std::string& out) {
		if (p >= end || *p != '"') return false;
		++p;
		while (p < end) {
			const char c = *p++;
			if (c == '"') return true;
			if (static_cast<unsigned char>(c) < 0x20) return false;
			if (c != '\\') {
				out += c;
				continue;
			}
			if (p >= end) return false;
			switch (*p++) {
			case '"': out += '"'; break;
			case '\\': out += '\\'; break;
			case '/': out += '/'; break;
			case 'b': out += '\b'; break;
			case 'f': out += '\f'; break;
			case 'n': out += '\n'; break;
			case 'r': out += '\r'; break;
			case 't': out += '\t'; break;
			case 'u': {
				uint32_t code = 0;
				if (!hex4(code)) return false;
				if (code >= 0xD800 && code < 0xDC00 && end - p >= 6 && p[0] == '\\' && p[1] == 'u') {
					const char* rewind = p;
					p += 2;
					uint32_t low = 0;
					if (hex4(low) && low >= 0xDC00 && low < 0xE000) code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
					else p = rewind;
				}
				append(out, code >= 0xD800 && code < 0xE000 ? 0xFFFD : code);
				break;
			}
			default: return false;
			}
		}
		return false;
	}

	bool value(Json& out, int depth) {
		if (depth > 32) return false;
		space();
		if (p >= end) return false;
		if (*p == '{') {
			++p;
			out.kind = Json::Object;
			space();
			if (p < end && *p == '}') return ++p, true;
			while (true) {
				space();
				std::string key;
				if (!string(key)) return false;
				space();
				if (p >= end || *p++ != ':') return false;
				Json item;
				if (!value(item, depth + 1)) return false;
				out.fields.emplace_back(std::move(key), std::move(item));
				space();
				if (p < end && *p == ',') {
					++p;
					continue;
				}
				return p < end && *p++ == '}';
			}
		}
		if (*p == '[') {
			++p;
			out.kind = Json::Array;
			space();
			if (p < end && *p == ']') return ++p, true;
			while (true) {
				Json item;
				if (!value(item, depth + 1)) return false;
				out.items.push_back(std::move(item));
				space();
				if (p < end && *p == ',') {
					++p;
					continue;
				}
				return p < end && *p++ == ']';
			}
		}
		if (*p == '"') {
			out.kind = Json::String;
			return string(out.text);
		}
		if (literal("true")) return out.kind = Json::Bool, out.boolean = true, true;
		if (literal("false")) return out.kind = Json::Bool, true;
		if (literal("null")) return true;
		char* stop = nullptr;
		out.number = std::strtod(p, &stop);  // the line buffer is null-terminated
		if (stop == p || stop > end) return false;
		p = stop;
		out.kind = Json::Number;
		return true;
	}
};

bool parseJson(const std::string& text, Json& out) {
	JsonParser parser{text.c_str(), text.c_str() + text.size()};
	if (!parser.value(out, 0)) return false;
	parser.space();
	return parser.p == parser.end;
}

std::string quote(const std::string& text) {
	std::string out = "\"";
	for (const char c : text) {
		switch (c) {
		case '"': out += "\\\""; break;
		case '\\': out += "\\\\"; break;
		case '\n': out += "\\n"; break;
		case '\r': out += "\\r"; break;
		case '\t': out += "\\t"; break;
		default:
			if (static_cast<unsigned char>(c) < 0x20) {
				char escaped[8];
				std::snprintf(escaped, sizeof escaped, "\\u%04x", static_cast<unsigned>(c));
				out += escaped;
			} else {
				out += c;
			}
		}
	}
	return out + "\"";
}

std::string quote(const std::wstring& text) { return quote(narrow(text)); }

std::string num(double value) {
	if (!std::isfinite(value)) return "0";
	if (value == std::floor(value) && std::fabs(value) < 9e15) return std::to_string(static_cast<long long>(value));
	char buffer[32];
	std::snprintf(buffer, sizeof buffer, "%.10g", value);
	return buffer;
}

const char* boolText(bool value) { return value ? "true" : "false"; }

// ---- output, shared state and held input ----------------------------------------------------------

HANDLE stdoutHandle = nullptr;
std::mutex outputLock;

[[noreturn]] void releaseAndExit();

void send(const std::string& json) {
	const std::string line = json + "\n";
	std::lock_guard<std::mutex> lock(outputLock);
	const char* data = line.data();
	size_t remaining = line.size();
	while (remaining > 0) {
		DWORD written = 0;
		if (!WriteFile(stdoutHandle, data, static_cast<DWORD>(remaining), &written, nullptr) || written == 0) {
			releaseAndExit();
		}
		data += written;
		remaining -= written;
	}
}

class SharedState {
public:
	int currentEpoch() {
		std::lock_guard<std::mutex> lock(mutex_);
		return epoch_;
	}

	std::optional<int> armedToken() {
		std::lock_guard<std::mutex> lock(mutex_);
		if (armedEpoch_ && *armedEpoch_ == epoch_) return epoch_;
		return std::nullopt;
	}

	void setArmed(bool armed) {
		std::lock_guard<std::mutex> lock(mutex_);
		if (armed) {
			armedEpoch_ = epoch_;
			drift_ = 0;
			driftStart_ = uptime();
		} else {
			++epoch_;
			armedEpoch_.reset();
		}
	}

	void pointerMoved(double dx, double dy) {
		bool tookOver = false;
		{
			std::lock_guard<std::mutex> lock(mutex_);
			const double now = uptime();
			if (now - driftStart_ > kDriftWindow) {
				drift_ = 0;
				driftStart_ = now;
			}
			drift_ += std::hypot(dx, dy);
			tookOver = drift_ > driftLimit;
		}
		if (tookOver) userInput("move", false);
	}

	// The event is written under the lock that guards the epoch, so it always precedes the
	// "user-input" error of the action it aborts.
	void userInput(const char* kind, bool escape) {
		std::lock_guard<std::mutex> lock(mutex_);
		if (!armedEpoch_) return;
		const bool firstAfterArm = *armedEpoch_ == epoch_;
		++epoch_;
		const double now = uptime();
		if (firstAfterArm || escape || now - lastEmit_ >= 0.25) {
			lastEmit_ = now;
			send(std::string("{\"event\":\"user-input\",\"kind\":\"") + kind + "\",\"escape\":" + boolText(escape) + "}");
		}
	}

private:
	std::mutex mutex_;
	int epoch_ = 0;
	std::optional<int> armedEpoch_;
	double lastEmit_ = 0;
	double drift_ = 0;
	double driftStart_ = 0;
};

class HeldInput {
public:
	int press(const std::function<void()>& down, std::function<void()> release) {
		std::lock_guard<std::mutex> lock(mutex_);
		if (stopped_) throw Failure{"Recordly's input helper is stopping"};
		down();
		held_.push_back({++nextId_, std::move(release)});
		return nextId_;
	}

	void release(int id) {
		std::lock_guard<std::mutex> lock(mutex_);
		const auto entry = std::find_if(held_.begin(), held_.end(), [id](const Entry& each) { return each.id == id; });
		if (entry == held_.end()) return;
		const auto release = std::move(entry->release);
		held_.erase(entry);
		release();
	}

	void releaseAll() {
		std::lock_guard<std::mutex> lock(mutex_);
		stopped_ = true;
		while (!held_.empty()) {
			const auto release = std::move(held_.back().release);
			held_.pop_back();
			release();
		}
	}

private:
	struct Entry {
		int id;
		std::function<void()> release;
	};
	std::mutex mutex_;
	std::vector<Entry> held_;
	int nextId_ = 0;
	bool stopped_ = false;
};

SharedState state;
HeldInput held;

void releaseAndExit() {
	held.releaseAll();
	ExitProcess(0);
}

// ---- request fields -----------------------------------------------------------------------------

double number(const Json& request, const char* key) {
	const Json* value = request[key];
	if (!value || value->kind != Json::Number || !std::isfinite(value->number)) {
		throw Failure{std::string("missing or invalid ") + key};
	}
	return value->number;
}

double optionalNumber(const Json& request, const char* key, double fallback) {
	const Json* value = request[key];
	return value && value->kind == Json::Number && std::isfinite(value->number) ? value->number : fallback;
}

int integer(const Json& request, const char* key, int fallback, int low, int high) {
	const double value = optionalNumber(request, key, fallback);
	if (std::round(value) != value || value < low || value > high) {
		throw Failure{std::string(key) + " must be a whole number from " + std::to_string(low) + " to " + std::to_string(high)};
	}
	return static_cast<int>(value);
}

double milliseconds(const Json& request, double fallback) {
	return std::clamp(optionalNumber(request, "ms", fallback), 0.0, 600000.0);
}

std::string text(const Json& request, const char* key, const char* fallback = "") {
	const Json* value = request[key];
	return value && value->kind == Json::String ? value->text : fallback;
}

POINT point(const Json& request, const char* xKey, const char* yKey) {
	return {static_cast<LONG>(std::lround(number(request, xKey))), static_cast<LONG>(std::lround(number(request, yKey)))};
}

RECT frame(const Json& request) {
	const Json* raw = request["frame"];
	if (!raw || raw->kind != Json::Object) throw Failure{"missing frame"};
	const double x = number(*raw, "x");
	const double y = number(*raw, "y");
	return {static_cast<LONG>(std::lround(x)), static_cast<LONG>(std::lround(y)),
		static_cast<LONG>(std::lround(x + number(*raw, "width"))), static_cast<LONG>(std::lround(y + number(*raw, "height")))};
}

DWORD pid(const Json& request) {
	const Json* value = request["pid"];
	if (!value || value->kind != Json::Number || value->number < 1 || value->number > 0xFFFFFFFF) {
		throw Failure{"missing or invalid pid"};
	}
	return static_cast<DWORD>(value->number);
}

HWND windowId(const Json& request) {
	const double value = optionalNumber(request, "windowId", 0);
	return value >= 1 ? reinterpret_cast<HWND>(static_cast<intptr_t>(value)) : nullptr;
}

// ---- timing ---------------------------------------------------------------------------------------

void checkAbort(int epoch) {
	if (state.currentEpoch() != epoch) throw Failure{"user-input"};
}

void pauseUntil(double deadline, int epoch) {
	while (true) {
		checkAbort(epoch);
		const double remaining = deadline - uptime();
		if (remaining <= 0) return;
		Sleep(static_cast<DWORD>(std::ceil(std::min(remaining, 0.01) * 1000)));
	}
}

void pauseFor(double ms, int epoch) { pauseUntil(uptime() + ms / 1000, epoch); }

double ease(double t) { return t < 0.5 ? 4 * t * t * t : 1 - std::pow(-2 * t + 2, 3) / 2; }

// ---- injection ------------------------------------------------------------------------------------

void inject(std::vector<INPUT> inputs) {
	for (auto& input : inputs) {
		if (input.type == INPUT_MOUSE) input.mi.dwExtraInfo = kAgentTag;
		else input.ki.dwExtraInfo = kAgentTag;
	}
	SendInput(static_cast<UINT>(inputs.size()), inputs.data(), sizeof(INPUT));
}

INPUT mouseInput(DWORD flags, LONG dx = 0, LONG dy = 0, LONG data = 0) {
	INPUT input{};
	input.type = INPUT_MOUSE;
	input.mi.dx = dx;
	input.mi.dy = dy;
	input.mi.mouseData = static_cast<DWORD>(data);
	input.mi.dwFlags = flags;
	return input;
}

// Absolute coordinates are 0..65535 across the virtual desktop; Windows maps them back with
// floor(units * size / 65536), so rounding up lands exactly on the requested pixel.
LONG normalized(double value, int origin, int size) {
	const double units = std::ceil((std::floor(value + 0.5) - origin) * 65536.0 / std::max(size, 1));
	return static_cast<LONG>(std::clamp(units, 0.0, 65535.0));
}

INPUT absoluteMouse(DWORD flags, double x, double y) {
	return mouseInput(flags | MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
		normalized(x, GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_CXVIRTUALSCREEN)),
		normalized(y, GetSystemMetrics(SM_YVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN)));
}

POINT cursorLocation() {
	POINT location{};
	GetCursorPos(&location);
	return location;
}

HKL foregroundLayout() {
	const HWND window = GetForegroundWindow();
	return GetKeyboardLayout(window ? GetWindowThreadProcessId(window, nullptr) : 0);
}

bool isExtendedKey(WORD vk) {
	switch (vk) {
	case VK_INSERT: case VK_DELETE: case VK_HOME: case VK_END: case VK_PRIOR: case VK_NEXT:
	case VK_LEFT: case VK_RIGHT: case VK_UP: case VK_DOWN: case VK_DIVIDE: case VK_LWIN:
	case VK_RWIN: case VK_APPS: case VK_RCONTROL: case VK_RMENU: case VK_NUMLOCK: case VK_SNAPSHOT:
		return true;
	default:
		return false;
	}
}

INPUT keyInput(WORD vk, bool down, bool extended = false) {
	INPUT input{};
	input.type = INPUT_KEYBOARD;
	input.ki.wVk = vk;
	input.ki.wScan = static_cast<WORD>(MapVirtualKeyExW(vk, MAPVK_VK_TO_VSC, foregroundLayout()) & 0xFF);
	input.ki.dwFlags = (down ? 0 : KEYEVENTF_KEYUP) | (extended || isExtendedKey(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
	return input;
}

constexpr unsigned kCtrl = 1, kAlt = 2, kShift = 4, kCmd = 8, kFn = 16;

struct ModifierKey {
	const char* name;
	unsigned flag;
	WORD vk;
};

const ModifierKey kModifierKeys[] = {
	{"ctrl", kCtrl, VK_LCONTROL}, {"alt", kAlt, VK_LMENU}, {"shift", kShift, VK_LSHIFT}, {"cmd", kCmd, VK_LWIN}, {"fn", kFn, 0},
};

unsigned modifierFlags(const Json& request) {
	unsigned flags = 0;
	const Json* list = request["modifiers"];
	if (!list || list->kind != Json::Array) return 0;
	for (const auto& item : list->items) {
		const auto key = std::find_if(std::begin(kModifierKeys), std::end(kModifierKeys),
			[&](const ModifierKey& each) { return item.kind == Json::String && item.text == each.name; });
		if (key == std::end(kModifierKeys)) {
			throw Failure{"unknown modifier: " + (item.kind == Json::String ? item.text : std::string("?")) + ". Use cmd, shift, alt, ctrl or fn"};
		}
		flags |= key->flag;
	}
	return flags;
}

void holdModifiers(unsigned flags, int epoch, const std::function<void()>& body) {
	std::vector<int> ids;
	struct Release {
		std::vector<int>& ids;
		~Release() {
			for (auto id = ids.rbegin(); id != ids.rend(); ++id) held.release(*id);
		}
	} release{ids};
	for (const auto& key : kModifierKeys) {
		if (!(flags & key.flag) || !key.vk) continue;
		checkAbort(epoch);
		const WORD vk = key.vk;
		const bool mask = vk == VK_LWIN || vk == VK_LMENU;
		ids.push_back(held.press([vk] { inject({keyInput(vk, true)}); }, [vk, mask] {
			if (mask) inject({keyInput(kMaskKey, true), keyInput(kMaskKey, false), keyInput(vk, false)});
			else inject({keyInput(vk, false)});
		}));
	}
	if (!ids.empty()) pauseFor(15, epoch);
	body();
	if (!ids.empty()) Sleep(15);
}

struct MouseButton {
	DWORD down;
	DWORD up;
};

MouseButton mouseButton(const Json& request) {
	const std::string name = text(request, "button", "left");
	const MouseButton left{MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP};
	const MouseButton right{MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP};
	// SendInput buttons are physical; swap so "left" stays the primary button.
	const bool swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
	if (name == "left") return swapped ? right : left;
	if (name == "right") return swapped ? left : right;
	if (name == "middle") return {MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP};
	throw Failure{"unknown button: " + name};
}

int pressButton(MouseButton button, POINT at) {
	return held.press([=] { inject({absoluteMouse(button.down, at.x, at.y)}); }, [=] { inject({mouseInput(button.up)}); });
}

void glide(POINT target, double ms, int epoch) {
	checkAbort(epoch);
	const POINT start = cursorLocation();
	const int steps = ms > 0 ? std::max(1, static_cast<int>(std::lround(ms * 120 / 1000))) : 1;
	const double startTime = uptime();
	for (int step = 1; step <= steps; ++step) {
		checkAbort(epoch);
		const double progress = ease(static_cast<double>(step) / steps);
		inject({absoluteMouse(0, start.x + (target.x - start.x) * progress, start.y + (target.y - start.y) * progress)});
		pauseUntil(startTime + ms / 1000 * step / steps, epoch);
	}
}

void approach(POINT target, int epoch) {
	const POINT start = cursorLocation();
	if (std::hypot(start.x - target.x, start.y - target.y) > 2) glide(target, 300, epoch);
}

void tap(WORD vk, bool extended = false) {
	const int id = held.press([=] { inject({keyInput(vk, true, extended)}); }, [=] { inject({keyInput(vk, false, extended)}); });
	Sleep(8);
	held.release(id);
}

std::vector<std::wstring> characters(const std::wstring& text) {
	std::vector<std::wstring> out;
	for (size_t index = 0; index < text.size();) {
		size_t length = 1;
		if (index + 1 < text.size() &&
			((text[index] == L'\r' && text[index + 1] == L'\n') || (IS_HIGH_SURROGATE(text[index]) && IS_LOW_SURROGATE(text[index + 1])))) {
			length = 2;
		}
		out.push_back(text.substr(index, length));
		index += length;
	}
	return out;
}

void typeCharacter(const std::wstring& character) {
	if (character == L"\n" || character == L"\r" || character == L"\r\n") return tap(VK_RETURN);
	if (character == L"\t") return tap(VK_TAB);
	std::vector<INPUT> inputs;
	for (const wchar_t unit : character) {
		INPUT down{};
		down.type = INPUT_KEYBOARD;
		down.ki.wScan = unit;
		down.ki.dwFlags = KEYEVENTF_UNICODE;
		INPUT up = down;
		up.ki.dwFlags |= KEYEVENTF_KEYUP;
		inputs.push_back(down);
		inputs.push_back(up);
	}
	inject(inputs);
}

// ---- input commands -------------------------------------------------------------------------------

using Action = std::function<void(int)>;

Action move(const Json& request) {
	const POINT target = point(request, "x", "y");
	const double ms = milliseconds(request, 0);
	return [=](int epoch) { glide(target, ms, epoch); };
}

Action click(const Json& request) {
	const POINT target = point(request, "x", "y");
	const MouseButton button = mouseButton(request);
	const unsigned modifiers = modifierFlags(request);
	const int count = integer(request, "count", 1, 1, 3);
	const double ms = milliseconds(request, 0);
	return [=](int epoch) {
		glide(target, ms, epoch);
		pauseFor(250, epoch);
		holdModifiers(modifiers, epoch, [&] {
			for (int clickState = 1; clickState <= count; ++clickState) {
				if (clickState > 1) pauseFor(90, epoch);
				checkAbort(epoch);
				const int id = pressButton(button, target);
				Sleep(60);
				held.release(id);
			}
		});
	};
}

Action drag(const Json& request) {
	const POINT from = point(request, "fromX", "fromY");
	const POINT to = point(request, "toX", "toY");
	const MouseButton button = mouseButton(request);
	const unsigned modifiers = modifierFlags(request);
	const double ms = std::max(milliseconds(request, 0), 150.0);
	return [=](int epoch) {
		approach(from, epoch);
		holdModifiers(modifiers, epoch, [&] {
			pauseFor(50, epoch);
			const int id = pressButton(button, from);
			struct Release {
				int id;
				~Release() { held.release(id); }
			} release{id};
			pauseFor(120, epoch);
			glide(to, ms, epoch);
			pauseFor(120, epoch);
		});
	};
}

Action scroll(const Json& request) {
	const POINT target = point(request, "x", "y");
	const double dy = std::clamp(optionalNumber(request, "dy", 0), -1e6, 1e6);
	const double dx = std::clamp(optionalNumber(request, "dx", 0), -1e6, 1e6);
	const double requested = milliseconds(request, 400);
	const double ms = requested > 0 ? requested : 400;
	const unsigned modifiers = modifierFlags(request);
	return [=](int epoch) {
		approach(target, epoch);
		holdModifiers(modifiers, epoch, [&] {
			const int steps = std::max(1, static_cast<int>(std::lround(ms / 16)));
			const double startTime = uptime();
			long sentX = 0;
			long sentY = 0;
			for (int step = 1; step <= steps; ++step) {
				checkAbort(epoch);
				const double progress = ease(static_cast<double>(step) / steps);
				const long wantY = std::lround(dy * kWheelPerPixel * progress);
				const long wantX = std::lround(dx * kWheelPerPixel * progress);
				// Positive dy scrolls down (a negative wheel delta); positive dx scrolls right.
				if (wantY != sentY) inject({mouseInput(MOUSEEVENTF_WHEEL, 0, 0, -(wantY - sentY))});
				if (wantX != sentX) inject({mouseInput(MOUSEEVENTF_HWHEEL, 0, 0, wantX - sentX)});
				sentY = wantY;
				sentX = wantX;
				pauseUntil(startTime + ms / 1000 * step / steps, epoch);
			}
		});
	};
}

Action typeText(const Json& request) {
	const Json* value = request["text"];
	if (!value || value->kind != Json::String) throw Failure{"missing text"};
	const auto typed = characters(widen(value->text));
	const double cps = optionalNumber(request, "cps", 15);
	const double interval = 1 / (cps > 0 ? cps : 15);
	return [=](int epoch) {
		const double start = uptime();
		for (size_t index = 0; index < typed.size(); ++index) {
			pauseUntil(start + static_cast<double>(index) * interval, epoch);
			typeCharacter(typed[index]);
		}
	};
}

const std::map<std::string, std::pair<WORD, bool>>& namedKeys() {
	static const auto keys = [] {
		std::map<std::string, std::pair<WORD, bool>> table = {
			{"enter", {VK_RETURN, false}}, {"tab", {VK_TAB, false}}, {"space", {VK_SPACE, false}},
			{"backspace", {VK_BACK, false}}, {"escape", {VK_ESCAPE, false}}, {"delete", {VK_DELETE, false}},
			{"home", {VK_HOME, false}}, {"end", {VK_END, false}}, {"pageup", {VK_PRIOR, false}},
			{"pagedown", {VK_NEXT, false}}, {"left", {VK_LEFT, false}}, {"right", {VK_RIGHT, false}},
			{"down", {VK_DOWN, false}}, {"up", {VK_UP, false}}, {"keypaddecimal", {VK_DECIMAL, false}},
			{"keypadmultiply", {VK_MULTIPLY, false}}, {"keypadplus", {VK_ADD, false}},
			{"keypadclear", {VK_CLEAR, false}}, {"keypaddivide", {VK_DIVIDE, false}},
			{"keypadenter", {VK_RETURN, true}}, {"keypadminus", {VK_SUBTRACT, false}},
		};
		for (int index = 1; index <= 20; ++index) table["f" + std::to_string(index)] = {static_cast<WORD>(VK_F1 + index - 1), false};
		for (int index = 0; index < 10; ++index) table["keypad" + std::to_string(index)] = {static_cast<WORD>(VK_NUMPAD0 + index), false};
		return table;
	}();
	return keys;
}

const std::map<std::string, std::string> kPunctuationKeys = {
	{"minus", "-"}, {"equal", "="}, {"leftbracket", "["}, {"rightbracket", "]"}, {"backslash", "\\"},
	{"semicolon", ";"}, {"quote", "'"}, {"comma", ","}, {"period", "."}, {"slash", "/"}, {"grave", "`"},
	{"keypadequals", "="},
};

struct KeyStroke {
	bool isText = false;
	WORD vk = 0;
	bool extended = false;
	unsigned modifiers = 0;
	std::wstring character;
};

// Dead keys and keys that need more than Shift/Ctrl/Alt do not count as single keys.
bool producesExactly(BYTE vk, BYTE shiftState, wchar_t character, HKL layout) {
	if (shiftState & ~7) return false;
	BYTE keys[256] = {};
	if (shiftState & 1) keys[VK_SHIFT] = 0x80;
	if (shiftState & 2) keys[VK_CONTROL] = 0x80;
	if (shiftState & 4) keys[VK_MENU] = 0x80;
	wchar_t produced[8] = {};
	const int count = ToUnicodeEx(vk, MapVirtualKeyExW(vk, MAPVK_VK_TO_VSC, layout), keys, produced, 8, 0x4, layout);
	return count == 1 && produced[0] == character;
}

KeyStroke resolveKey(const std::string& name, unsigned modifiers) {
	const auto named = namedKeys().find(name);
	if (named != namedKeys().end()) return {false, named->second.first, named->second.second, modifiers, {}};
	const auto punctuation = kPunctuationKeys.find(name);
	const std::wstring character = widen(punctuation != kPunctuationKeys.end() ? punctuation->second : name);
	const bool single = character.size() == 1 ||
		(character.size() == 2 && IS_HIGH_SURROGATE(character[0]) && IS_LOW_SURROGATE(character[1]));
	if (!single) {
		throw Failure{"unknown key: " + name +
			". Use a key name such as enter, tab, escape, backspace, delete, up, pagedown or f5, or one character such as "
			"a, ? or \xC3\xA9. To enter text, use type_text"};
	}
	const HKL layout = foregroundLayout();
	if (character.size() == 1) {
		const SHORT scan = VkKeyScanExW(character[0], layout);
		const BYTE vk = LOBYTE(scan);
		const BYTE shiftState = HIBYTE(scan);
		if (scan != -1 && producesExactly(vk, shiftState, character[0], layout)) {
			const unsigned layoutModifiers = (shiftState & 1 ? kShift : 0) | (shiftState & 2 ? kCtrl : 0) | (shiftState & 4 ? kAlt : 0);
			return {false, vk, false, modifiers | layoutModifiers, {}};
		}
		// Shortcuts match virtual-key codes, so Ctrl+C works on layouts without a Latin C.
		const wchar_t c = character[0];
		const bool letter = (c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z');
		if (modifiers && (letter || (c >= L'0' && c <= L'9'))) {
			return {false, static_cast<WORD>(towupper(c)), false, modifiers | (c >= L'A' && c <= L'Z' ? kShift : 0u), {}};
		}
	}
	if (!modifiers) return {true, 0, false, 0, character};
	char layoutId[20];
	std::snprintf(layoutId, sizeof layoutId, "%08llX", static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(layout) & 0xFFFFFFFFu));
	throw Failure{narrow(character) + " is not a single key on the current keyboard layout (" + layoutId +
		"), so it cannot be pressed with modifiers. Press it without modifiers, or use type_text"};
}

Action key(const Json& request) {
	const std::string name = text(request, "key");
	if (name.empty()) throw Failure{"missing key"};
	const unsigned modifiers = modifierFlags(request);
	const int count = integer(request, "repeat", 1, 1, 100);
	const KeyStroke stroke = resolveKey(name, modifiers);
	return [=](int epoch) {
		holdModifiers(stroke.modifiers, epoch, [&] {
			const double start = uptime();
			for (int index = 0; index < count; ++index) {
				pauseUntil(start + index * 0.035, epoch);
				if (stroke.isText) typeCharacter(stroke.character);
				else tap(stroke.vk, stroke.extended);
			}
		});
	};
}

// ---- takeover hooks -------------------------------------------------------------------------------

constexpr UINT kInstallHooks = WM_APP + 1;
constexpr UINT kRemoveHooks = WM_APP + 2;
HHOOK mouseHook = nullptr;
HHOOK keyboardHook = nullptr;
POINT lastPoint{};
DWORD hookThreadId = 0;
std::once_flag hookThreadOnce;

// Events we injected carry both the injected flag and our tag; injected events from any other
// tool count as the user's.
LRESULT CALLBACK mouseProc(int code, WPARAM message, LPARAM data) {
	if (code == HC_ACTION) {
		const auto* info = reinterpret_cast<const MSLLHOOKSTRUCT*>(data);
		const bool ours = (info->flags & LLMHF_INJECTED) && info->dwExtraInfo == kAgentTag;
		if (message == WM_MOUSEMOVE) {
			const double dx = info->pt.x - lastPoint.x;
			const double dy = info->pt.y - lastPoint.y;
			lastPoint = info->pt;
			if (!ours) state.pointerMoved(dx, dy);
		} else if (!ours) {
			if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL) {
				if (static_cast<short>(HIWORD(info->mouseData)) != 0) state.userInput("scroll", false);
			} else {
				state.userInput("button", false);
			}
		}
	}
	return CallNextHookEx(nullptr, code, message, data);
}

bool isModifierKey(DWORD vk) {
	switch (vk) {
	case VK_SHIFT: case VK_LSHIFT: case VK_RSHIFT: case VK_CONTROL: case VK_LCONTROL: case VK_RCONTROL:
	case VK_MENU: case VK_LMENU: case VK_RMENU: case VK_LWIN: case VK_RWIN: case VK_CAPITAL:
		return true;
	default:
		return false;
	}
}

LRESULT CALLBACK keyboardProc(int code, WPARAM message, LPARAM data) {
	if (code == HC_ACTION) {
		const auto* info = reinterpret_cast<const KBDLLHOOKSTRUCT*>(data);
		const bool ours = (info->flags & LLKHF_INJECTED) && info->dwExtraInfo == kAgentTag;
		const bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
		if (!ours && (down || isModifierKey(info->vkCode))) state.userInput("key", down && info->vkCode == VK_ESCAPE);
	}
	return CallNextHookEx(nullptr, code, message, data);
}

using Reply = std::shared_ptr<std::promise<bool>>;

// Low-level hooks run on the thread that installed them, which needs a message loop.
void hookThread(std::shared_ptr<std::promise<DWORD>> ready) {
	SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
	MSG message;
	PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
	ready->set_value(GetCurrentThreadId());
	while (GetMessageW(&message, nullptr, 0, 0) > 0) {
		if (message.message != kInstallHooks && message.message != kRemoveHooks) continue;
		const std::unique_ptr<Reply> reply(reinterpret_cast<Reply*>(message.lParam));
		if (message.message == kInstallHooks) {
			if (!mouseHook) {
				GetCursorPos(&lastPoint);
				mouseHook = SetWindowsHookExW(WH_MOUSE_LL, mouseProc, GetModuleHandleW(nullptr), 0);
				if (mouseHook) keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboardProc, GetModuleHandleW(nullptr), 0);
			}
			(*reply)->set_value(mouseHook != nullptr);
		} else {
			if (keyboardHook) UnhookWindowsHookEx(keyboardHook);
			if (mouseHook) UnhookWindowsHookEx(mouseHook);
			keyboardHook = nullptr;
			mouseHook = nullptr;
			(*reply)->set_value(true);
		}
	}
}

bool callHookThread(UINT message) {
	std::call_once(hookThreadOnce, [] {
		auto ready = std::make_shared<std::promise<DWORD>>();
		auto id = ready->get_future();
		std::thread(hookThread, ready).detach();
		hookThreadId = id.get();
	});
	auto reply = std::make_shared<std::promise<bool>>();
	auto result = reply->get_future();
	auto* carrier = new Reply(reply);
	if (!PostThreadMessageW(hookThreadId, message, 0, reinterpret_cast<LPARAM>(carrier))) {
		delete carrier;
		return false;
	}
	return result.get();
}

void arm() {
	if (!callHookThread(kInstallHooks)) throw Failure{"input hooks unavailable"};
	state.setArmed(true);
}

void disarm() {
	state.setArmed(false);
	callHookThread(kRemoveHooks);
}

// ---- windows --------------------------------------------------------------------------------------

template <typename T>
struct Com {
	T* p = nullptr;
	Com() = default;
	Com(Com&& other) noexcept : p(other.p) { other.p = nullptr; }
	Com& operator=(Com&& other) noexcept {
		std::swap(p, other.p);
		return *this;
	}
	~Com() {
		if (p) p->Release();
	}
	T** put() {
		if (p) p->Release();
		p = nullptr;
		return &p;
	}
	T* operator->() const { return p; }
	explicit operator bool() const { return p != nullptr; }
};

DWORD windowPid(HWND window) {
	DWORD owner = 0;
	GetWindowThreadProcessId(window, &owner);
	return owner;
}

bool windowBounds(HWND window, RECT& bounds) {
	return SUCCEEDED(DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof bounds)) ||
		GetWindowRect(window, &bounds);
}

struct WindowSearch {
	DWORD pid;
	RECT frame;
	HWND found;
};

BOOL CALLBACK matchFrame(HWND window, LPARAM data) {
	auto* search = reinterpret_cast<WindowSearch*>(data);
	RECT bounds;
	if (!IsWindowVisible(window) || windowPid(window) != search->pid || !windowBounds(window, bounds)) return TRUE;
	if (std::abs(bounds.left - search->frame.left) <= 4 && std::abs(bounds.top - search->frame.top) <= 4 &&
		std::abs(bounds.right - search->frame.right) <= 4 && std::abs(bounds.bottom - search->frame.bottom) <= 4) {
		search->found = window;
		return FALSE;
	}
	return TRUE;
}

// Window ids are HWNDs, as in desktopCapturer's "window:<hwnd>:0" source ids.
HWND matchWindow(const Json& request, DWORD owner, const RECT& target) {
	const HWND window = windowId(request);
	if (window && IsWindow(window) && windowPid(window) == owner) return window;
	WindowSearch search{owner, target, nullptr};
	EnumWindows(matchFrame, reinterpret_cast<LPARAM>(&search));
	return search.found;
}

std::wstring processPath(DWORD owner) {
	const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, owner);
	if (!process) return {};
	wchar_t path[MAX_PATH * 4];
	DWORD length = static_cast<DWORD>(std::size(path));
	const bool ok = QueryFullProcessImageNameW(process, 0, path, &length);
	CloseHandle(process);
	return ok ? std::wstring(path, length) : std::wstring();
}

std::wstring fileDescription(const std::wstring& path) {
	DWORD ignored = 0;
	const DWORD size = path.empty() ? 0 : GetFileVersionInfoSizeW(path.c_str(), &ignored);
	if (!size) return {};
	std::vector<BYTE> data(size);
	if (!GetFileVersionInfoW(path.c_str(), 0, size, data.data())) return {};
	struct Translation {
		WORD language;
		WORD codePage;
	}* translation = nullptr;
	UINT length = 0;
	if (!VerQueryValueW(data.data(), L"\\VarFileInfo\\Translation", reinterpret_cast<void**>(&translation), &length) ||
		length < sizeof(Translation)) {
		return {};
	}
	char key[64];
	std::snprintf(key, sizeof key, "\\StringFileInfo\\%04x%04x\\FileDescription", translation->language, translation->codePage);
	wchar_t* value = nullptr;
	if (!VerQueryValueW(data.data(), widen(key).c_str(), reinterpret_cast<void**>(&value), &length) || !value || !length) return {};
	return trim(value);
}

bool isElevated(HANDLE process) {
	HANDLE token = nullptr;
	if (!OpenProcessToken(process, TOKEN_QUERY, &token)) return false;
	TOKEN_ELEVATION elevation{};
	DWORD size = 0;
	const bool elevated = GetTokenInformation(token, TokenElevation, &elevation, sizeof elevation, &size) && elevation.TokenIsElevated;
	CloseHandle(token);
	return elevated;
}

std::string windowFields(HWND window, DWORD owner) {
	wchar_t title[512] = {};
	GetWindowTextW(window, title, static_cast<int>(std::size(title)));
	return "\"pid\":" + std::to_string(owner) + ",\"windowId\":" + std::to_string(reinterpret_cast<intptr_t>(window)) +
		",\"title\":" + quote(std::wstring(title));
}

std::string boundsFields(const RECT& bounds) {
	return "\"x\":" + num(bounds.left) + ",\"y\":" + num(bounds.top) + ",\"width\":" + num(bounds.right - bounds.left) +
		",\"height\":" + num(bounds.bottom - bounds.top);
}

std::wstring executableName(const std::wstring& path) { return path.substr(path.find_last_of(L"\\/") + 1); }

std::string frontmostWindow() {
	const HWND window = GetForegroundWindow();
	RECT bounds;
	if (!window || !windowBounds(window, bounds) || bounds.right - bounds.left < 50 || bounds.bottom - bounds.top < 50) {
		return "\"window\":null";
	}
	const DWORD owner = windowPid(window);
	const std::wstring path = processPath(owner);
	const std::wstring executable = executableName(path);
	std::wstring appName = fileDescription(path);
	if (appName.empty()) appName = executable.substr(0, executable.rfind(L'.'));
	return "\"window\":{" + windowFields(window, owner) + ",\"appName\":" + quote(appName) +
		",\"bundleId\":" + (executable.empty() ? std::string("null") : quote(executable)) + "," + boundsFields(bounds) + "}";
}

std::string windowInfo(const Json& request) {
	const HWND window = windowId(request);
	RECT bounds;
	if (!window || !IsWindow(window) || !windowBounds(window, bounds)) return "\"window\":null";
	const DWORD owner = windowPid(window);
	DWORD cloaked = 0;
	DwmGetWindowAttribute(window, DWMWA_CLOAKED, &cloaked, sizeof cloaked);
	return "\"window\":{" + windowFields(window, owner) + ",\"appName\":" + quote(executableName(processPath(owner))) +
		",\"frame\":{" + boundsFields(bounds) + "},\"visible\":" + boolText(IsWindowVisible(window) && !cloaked) +
		",\"minimized\":" + boolText(IsIconic(window)) + "}";
}

bool isFront(HWND window, DWORD owner) {
	const HWND front = GetForegroundWindow();
	return front && (front == window || windowPid(front) == owner);
}

// SetForegroundWindow only works for the process that produced the last input, so each attempt
// first injects tagged input: a no-op mouse event, then a masked Alt tap, then input attachment.
void bringToFront(HWND window) {
	inject({mouseInput(0)});
	if (SetForegroundWindow(window)) return;
	inject({keyInput(VK_MENU, true), keyInput(kMaskKey, true), keyInput(kMaskKey, false), keyInput(VK_MENU, false)});
	if (SetForegroundWindow(window)) return;
	const DWORD self = GetCurrentThreadId();
	const DWORD front = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
	if (front && front != self && AttachThreadInput(self, front, TRUE)) {
		BringWindowToTop(window);
		SetForegroundWindow(window);
		AttachThreadInput(self, front, FALSE);
	}
}

std::string raise(const Json& request) {
	const DWORD owner = pid(request);
	const RECT target = frame(request);
	const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, owner);
	DWORD exitCode = 0;
	if ((!process && GetLastError() == ERROR_INVALID_PARAMETER) ||
		(process && GetExitCodeProcess(process, &exitCode) && exitCode != STILL_ACTIVE)) {
		if (process) CloseHandle(process);
		throw Failure{"process " + std::to_string(owner) + " is not running"};
	}
	const bool blocked = process && isElevated(process) && !isElevated(GetCurrentProcess());
	if (process) CloseHandle(process);
	if (blocked) {
		throw Failure{"The window belongs to an app running as administrator. Windows blocks Recordly's input to it "
			"unless Recordly runs as administrator too"};
	}
	const HWND window = matchWindow(request, owner, target);
	if (!window) return "\"raised\":false";
	if (IsIconic(window)) ShowWindow(window, SW_RESTORE);
	bringToFront(window);
	const double deadline = uptime() + 1;
	while (!isFront(window, owner) && uptime() < deadline) Sleep(20);
	return std::string("\"raised\":") + boolText(isFront(window, owner));
}

// "bounds" are physical pixels (this process is per-monitor DPI aware) and describe the visible frame,
// the same rectangle "frame" reports. SetWindowPos wants the outer rectangle, which includes the invisible
// resize border Windows 10+ draws around a window, so that border is added back.
std::string setBounds(const Json& request) {
	const DWORD owner = pid(request);
	const RECT current = frame(request);
	const Json* raw = request["bounds"];
	if (!raw || raw->kind != Json::Object) throw Failure{"missing bounds"};
	const LONG x = static_cast<LONG>(std::lround(number(*raw, "x")));
	const LONG y = static_cast<LONG>(std::lround(number(*raw, "y")));
	const LONG width = static_cast<LONG>(std::lround(number(*raw, "width")));
	const LONG height = static_cast<LONG>(std::lround(number(*raw, "height")));
	if (width < 1 || height < 1) throw Failure{"width and height must be at least 1"};
	const HWND window = matchWindow(request, owner, current);
	if (!window) throw Failure{"the window could not be found"};
	if (IsIconic(window) || IsZoomed(window)) ShowWindow(window, SW_RESTORE);
	RECT outer, visible;
	if (!GetWindowRect(window, &outer)) throw Failure{"the window could not be measured"};
	if (!windowBounds(window, visible)) visible = outer;
	const LONG left = visible.left - outer.left, top = visible.top - outer.top;
	const LONG right = outer.right - visible.right, bottom = outer.bottom - visible.bottom;
	if (!SetWindowPos(window, nullptr, x - left, y - top, width + left + right, height + top + bottom,
			SWP_NOZORDER | SWP_NOACTIVATE)) {
		throw Failure{GetLastError() == ERROR_ACCESS_DENIED
			? "Windows blocked the move. The window belongs to an app running as administrator, so Recordly must run as administrator too"
			: "Windows refused to move or resize this window"};
	}
	RECT actual;
	if (!windowBounds(window, actual)) return "";
	return "\"frame\":{" + boundsFields(actual) + "}";
}

// ---- UI Automation --------------------------------------------------------------------------------

IUIAutomation* automation() {
	static IUIAutomation* const instance = [] {
		IUIAutomation* created = nullptr;
		if (FAILED(CoCreateInstance(__uuidof(CUIAutomation8), nullptr, CLSCTX_INPROC_SERVER, __uuidof(IUIAutomation),
				reinterpret_cast<void**>(&created)))) {
			created = nullptr;
			CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER, __uuidof(IUIAutomation),
				reinterpret_cast<void**>(&created));
		}
		Com<IUIAutomation2> tuned;
		if (created && SUCCEEDED(created->QueryInterface(__uuidof(IUIAutomation2), reinterpret_cast<void**>(tuned.put())))) {
			tuned->put_ConnectionTimeout(1000);
			tuned->put_TransactionTimeout(2000);
		}
		return created;
	}();
	return instance;
}

struct ControlTypeName {
	CONTROLTYPEID id;
	const char* name;
};

const ControlTypeName kControlTypes[] = {
	{UIA_ButtonControlTypeId, "Button"}, {UIA_CalendarControlTypeId, "Calendar"}, {UIA_CheckBoxControlTypeId, "CheckBox"},
	{UIA_ComboBoxControlTypeId, "ComboBox"}, {UIA_EditControlTypeId, "Edit"}, {UIA_HyperlinkControlTypeId, "Hyperlink"},
	{UIA_ImageControlTypeId, "Image"}, {UIA_ListItemControlTypeId, "ListItem"}, {UIA_ListControlTypeId, "List"},
	{UIA_MenuControlTypeId, "Menu"}, {UIA_MenuBarControlTypeId, "MenuBar"}, {UIA_MenuItemControlTypeId, "MenuItem"},
	{UIA_ProgressBarControlTypeId, "ProgressBar"}, {UIA_RadioButtonControlTypeId, "RadioButton"},
	{UIA_ScrollBarControlTypeId, "ScrollBar"}, {UIA_SliderControlTypeId, "Slider"}, {UIA_SpinnerControlTypeId, "Spinner"},
	{UIA_StatusBarControlTypeId, "StatusBar"}, {UIA_TabControlTypeId, "Tab"}, {UIA_TabItemControlTypeId, "TabItem"},
	{UIA_TextControlTypeId, "Text"}, {UIA_ToolBarControlTypeId, "ToolBar"}, {UIA_ToolTipControlTypeId, "ToolTip"},
	{UIA_TreeControlTypeId, "Tree"}, {UIA_TreeItemControlTypeId, "TreeItem"}, {UIA_CustomControlTypeId, "Custom"},
	{UIA_GroupControlTypeId, "Group"}, {UIA_ThumbControlTypeId, "Thumb"}, {UIA_DataGridControlTypeId, "DataGrid"},
	{UIA_DataItemControlTypeId, "DataItem"}, {UIA_DocumentControlTypeId, "Document"},
	{UIA_SplitButtonControlTypeId, "SplitButton"}, {UIA_WindowControlTypeId, "Window"}, {UIA_PaneControlTypeId, "Pane"},
	{UIA_HeaderControlTypeId, "Header"}, {UIA_HeaderItemControlTypeId, "HeaderItem"}, {UIA_TableControlTypeId, "Table"},
	{UIA_TitleBarControlTypeId, "TitleBar"}, {UIA_SeparatorControlTypeId, "Separator"},
	{UIA_SemanticZoomControlTypeId, "SemanticZoom"}, {UIA_AppBarControlTypeId, "AppBar"},
};

const char* controlTypeName(CONTROLTYPEID id) {
	for (const auto& type : kControlTypes) {
		if (type.id == id) return type.name;
	}
	return "Unknown";
}

// Same aliases as the macOS helper, plus its AX role names with the "AX" prefix dropped.
const std::map<std::string, std::set<int>> kRoleAliases = {
	{"button", {UIA_ButtonControlTypeId, UIA_SplitButtonControlTypeId}},
	{"menubutton", {UIA_ButtonControlTypeId, UIA_SplitButtonControlTypeId}},
	{"popupbutton", {UIA_ComboBoxControlTypeId, UIA_ButtonControlTypeId}},
	{"link", {UIA_HyperlinkControlTypeId}},
	{"textbox", {UIA_EditControlTypeId, UIA_ComboBoxControlTypeId}},
	{"textfield", {UIA_EditControlTypeId, UIA_ComboBoxControlTypeId}},
	{"textarea", {UIA_EditControlTypeId}},
	{"checkbox", {UIA_CheckBoxControlTypeId}},
	{"radio", {UIA_RadioButtonControlTypeId}},
	{"tab", {UIA_TabItemControlTypeId}},
	{"tabbutton", {UIA_TabItemControlTypeId}},
	{"menuitem", {UIA_MenuItemControlTypeId}},
	{"menubaritem", {UIA_MenuItemControlTypeId}},
	{"text", {UIA_TextControlTypeId}},
	{"statictext", {UIA_TextControlTypeId}},
	{"heading", {kHeadingRole}},
	{"image", {UIA_ImageControlTypeId}},
};

const std::set<int> kActionableRoles = {
	UIA_ButtonControlTypeId, UIA_SplitButtonControlTypeId, UIA_HyperlinkControlTypeId, UIA_EditControlTypeId,
	UIA_ComboBoxControlTypeId, UIA_CheckBoxControlTypeId, UIA_RadioButtonControlTypeId, UIA_TabItemControlTypeId,
	UIA_MenuItemControlTypeId,
};

std::string asciiLower(std::string text) {
	for (auto& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
	return text;
}

std::optional<std::set<int>> rolesFor(const std::string& query, bool hasText) {
	if (query.empty()) return hasText ? std::nullopt : std::optional<std::set<int>>(kActionableRoles);
	const std::string key = asciiLower(query.size() > 2 && query.compare(0, 2, "AX") == 0 ? query.substr(2) : query);
	const auto alias = kRoleAliases.find(key);
	if (alias != kRoleAliases.end()) return alias->second;
	for (const auto& type : kControlTypes) {
		if (asciiLower(type.name) == key) return std::set<int>{type.id};
	}
	throw Failure{"unknown role: " + query};
}

Com<IUIAutomationCondition> propertyCondition(IUIAutomation* uia, PROPERTYID property, VARIANT value, PropertyConditionFlags flags) {
	Com<IUIAutomationCondition> condition;
	if (FAILED(uia->CreatePropertyConditionEx(property, value, flags, condition.put()))) condition.put();
	return condition;
}

// All parts must exist; an empty list or a missing part yields no condition.
Com<IUIAutomationCondition> combine(IUIAutomation* uia, std::vector<Com<IUIAutomationCondition>>& parts, bool all) {
	Com<IUIAutomationCondition> combined;
	std::vector<IUIAutomationCondition*> raw;
	for (auto& part : parts) {
		if (!part) return combined;
		raw.push_back(part.p);
	}
	if (raw.empty()) return combined;
	if (all) uia->CreateAndConditionFromNativeArray(raw.data(), static_cast<int>(raw.size()), combined.put());
	else uia->CreateOrConditionFromNativeArray(raw.data(), static_cast<int>(raw.size()), combined.put());
	return combined;
}

Com<IUIAutomationCondition> roleCondition(IUIAutomation* uia, const std::set<int>& roles) {
	std::vector<Com<IUIAutomationCondition>> parts;
	for (const int role : roles) {
		VARIANT value;
		value.vt = VT_I4;
		if (role == kHeadingRole) {
			for (int level = kHeadingLevelNone + 1; level <= kHeadingLevel9; ++level) {
				value.lVal = level;
				parts.push_back(propertyCondition(uia, UIA_HeadingLevelPropertyId, value, PropertyConditionFlags_None));
			}
		} else {
			value.lVal = role;
			parts.push_back(propertyCondition(uia, UIA_ControlTypePropertyId, value, PropertyConditionFlags_None));
		}
	}
	return combine(uia, parts, false);
}

const PROPERTYID kTextProperties[] = {
	UIA_NamePropertyId, UIA_FullDescriptionPropertyId, UIA_LegacyIAccessibleDescriptionPropertyId,
	UIA_ValueValuePropertyId, UIA_HelpTextPropertyId,
};

// Substring matching runs inside the provider (Windows 10 1809+), so big trees are not copied over.
Com<IUIAutomationCondition> textCondition(IUIAutomation* uia, const std::wstring& query) {
	std::vector<Com<IUIAutomationCondition>> parts;
	for (const PROPERTYID property : kTextProperties) {
		VARIANT value;
		value.vt = VT_BSTR;
		value.bstrVal = SysAllocStringLen(query.data(), static_cast<UINT>(query.size()));
		parts.push_back(propertyCondition(uia, property, value,
			static_cast<PropertyConditionFlags>(PropertyConditionFlags_IgnoreCase | kMatchSubstring)));
		VariantClear(&value);
	}
	return combine(uia, parts, false);
}

std::wstring cachedString(IUIAutomationElement* element, PROPERTYID property) {
	VARIANT value;
	VariantInit(&value);
	std::wstring result;
	if (SUCCEEDED(element->GetCachedPropertyValueEx(property, TRUE, &value)) && value.vt == VT_BSTR && value.bstrVal) {
		result.assign(value.bstrVal, SysStringLen(value.bstrVal));
	}
	VariantClear(&value);
	return result;
}

int cachedInt(IUIAutomationElement* element, PROPERTYID property, int fallback) {
	VARIANT value;
	VariantInit(&value);
	int result = fallback;
	if (SUCCEEDED(element->GetCachedPropertyValueEx(property, TRUE, &value)) && value.vt == VT_I4) result = value.lVal;
	VariantClear(&value);
	return result;
}

bool cachedBool(IUIAutomationElement* element, PROPERTYID property) {
	VARIANT value;
	VariantInit(&value);
	const bool result = SUCCEEDED(element->GetCachedPropertyValueEx(property, TRUE, &value)) && value.vt == VT_BOOL &&
		value.boolVal == VARIANT_TRUE;
	VariantClear(&value);
	return result;
}

bool isHeading(IUIAutomationElement* element) {
	const int level = cachedInt(element, UIA_HeadingLevelPropertyId, kHeadingLevelNone);
	return (level > kHeadingLevelNone && level <= kHeadingLevel9) ||
		lowercase(cachedString(element, UIA_LocalizedControlTypePropertyId)) == L"heading";
}

std::string roleNameOf(IUIAutomationElement* element) {
	const int type = cachedInt(element, UIA_ControlTypePropertyId, 0);
	return isHeading(element) && type == UIA_TextControlTypeId ? "Heading" : controlTypeName(type);
}

std::wstring truncateLabel(std::wstring label) {
	if (label.size() > 200) label.resize(IS_HIGH_SURROGATE(label[199]) ? 199 : 200);
	return label;
}

std::wstring firstLabel(IUIAutomationElement* element, std::initializer_list<PROPERTYID> properties) {
	for (const PROPERTYID property : properties) {
		const std::wstring label = trim(cachedString(element, property));
		if (!label.empty()) return truncateLabel(label);
	}
	return {};
}

std::string runtimeKey(IUIAutomationElement* element) {
	VARIANT value;
	VariantInit(&value);
	std::string key;
	if (SUCCEEDED(element->GetCachedPropertyValueEx(UIA_RuntimeIdPropertyId, TRUE, &value)) && value.vt == (VT_I4 | VT_ARRAY) &&
		value.parray) {
		LONG low = 0;
		LONG high = -1;
		SafeArrayGetLBound(value.parray, 1, &low);
		SafeArrayGetUBound(value.parray, 1, &high);
		for (LONG index = low; index <= high; ++index) {
			int part = 0;
			SafeArrayGetElement(value.parray, &index, &part);
			key += std::to_string(part) + ".";
		}
	}
	VariantClear(&value);
	return key;
}

Com<IUIAutomationCacheRequest> cacheFor(IUIAutomation* uia, std::initializer_list<PROPERTYID> properties) {
	Com<IUIAutomationCacheRequest> cache;
	if (SUCCEEDED(uia->CreateCacheRequest(cache.put())) && cache) {
		for (const PROPERTYID property : properties) cache->AddProperty(property);  // ones this Windows lacks are skipped
	}
	return cache;
}

const std::set<std::wstring> kWebFrameworks = {L"Chrome", L"Gecko", L"MicrosoftEdge"};

struct Scope {
	std::map<std::string, RECT> clips;
	std::set<std::string> web;
};

// Like the macOS helper, a match is clipped by every scroll container and web document above it,
// and is "web" inside a web document. UIA results carry no ancestry, so each container's subtree
// is searched with the same condition and its matches are tagged by runtime id.
Scope scopeOf(IUIAutomation* uia, IUIAutomationElement* root, IUIAutomationCondition* matches) {
	Scope scope;
	VARIANT yes;
	yes.vt = VT_BOOL;
	yes.boolVal = VARIANT_TRUE;
	VARIANT document;
	document.vt = VT_I4;
	document.lVal = UIA_DocumentControlTypeId;
	std::vector<Com<IUIAutomationCondition>> frameworks;
	for (const auto& name : kWebFrameworks) {
		VARIANT value;
		value.vt = VT_BSTR;
		value.bstrVal = SysAllocString(name.c_str());
		frameworks.push_back(propertyCondition(uia, UIA_FrameworkIdPropertyId, value, PropertyConditionFlags_None));
		VariantClear(&value);
	}
	std::vector<Com<IUIAutomationCondition>> webDocument;
	webDocument.push_back(propertyCondition(uia, UIA_ControlTypePropertyId, document, PropertyConditionFlags_None));
	webDocument.push_back(combine(uia, frameworks, false));
	std::vector<Com<IUIAutomationCondition>> kinds;
	kinds.push_back(propertyCondition(uia, UIA_IsScrollPatternAvailablePropertyId, yes, PropertyConditionFlags_None));
	kinds.push_back(combine(uia, webDocument, true));
	const auto isContainer = combine(uia, kinds, false);
	const auto containerCache = cacheFor(uia, {UIA_ControlTypePropertyId, UIA_BoundingRectanglePropertyId, UIA_FrameworkIdPropertyId});
	const auto keyCache = cacheFor(uia, {UIA_RuntimeIdPropertyId});
	Com<IUIAutomationElementArray> containers;
	if (!isContainer || !containerCache || !keyCache ||
		FAILED(root->FindAllBuildCache(TreeScope_Descendants, isContainer.p, containerCache.p, containers.put())) || !containers) {
		return scope;
	}
	int count = 0;
	containers->get_Length(&count);
	for (int index = 0; index < std::min(count, 64); ++index) {  // ponytail: first 64 containers, enough for real pages
		Com<IUIAutomationElement> container;
		Com<IUIAutomationElementArray> inside;
		if (FAILED(containers->GetElement(index, container.put())) || !container ||
			FAILED(container->FindAllBuildCache(TreeScope_Descendants, matches, keyCache.p, inside.put())) || !inside) {
			continue;
		}
		RECT box{};
		container->get_CachedBoundingRectangle(&box);
		const bool web = cachedInt(container.p, UIA_ControlTypePropertyId, 0) == UIA_DocumentControlTypeId &&
			kWebFrameworks.count(cachedString(container.p, UIA_FrameworkIdPropertyId));
		int length = 0;
		inside->get_Length(&length);
		for (int each = 0; each < length; ++each) {
			Com<IUIAutomationElement> element;
			if (FAILED(inside->GetElement(each, element.put())) || !element) continue;
			const std::string key = runtimeKey(element.p);
			if (key.empty()) continue;
			if (web) scope.web.insert(key);
			const auto clip = scope.clips.emplace(key, box);
			if (!clip.second) IntersectRect(&clip.first->second, &clip.first->second, &box);
		}
	}
	return scope;
}

std::mutex wokenLock;
std::set<HWND> wokenWindows;

BOOL CALLBACK collectRenderWidgets(HWND child, LPARAM data) {
	wchar_t name[64] = {};
	if (GetClassNameW(child, name, static_cast<int>(std::size(name))) && std::wcscmp(name, L"Chrome_RenderWidgetHostHWND") == 0) {
		reinterpret_cast<std::vector<HWND>*>(data)->push_back(child);
	}
	return TRUE;
}

// Chromium and Electron build their web accessibility tree only once an assistive client asks
// the render widget for it. Ask once per window through MSAA and UIA, then wait for page content.
void wakeChromium(IUIAutomation* uia, HWND window) {
	std::vector<HWND> widgets;
	EnumChildWindows(window, collectRenderWidgets, reinterpret_cast<LPARAM>(&widgets));
	if (widgets.empty()) return;
	{
		std::lock_guard<std::mutex> lock(wokenLock);
		if (!wokenWindows.insert(window).second) return;
	}
	for (const HWND widget : widgets) {
		Com<IAccessible> accessible;
		AccessibleObjectFromWindow(widget, static_cast<DWORD>(OBJID_CLIENT), IID_IAccessible, reinterpret_cast<void**>(accessible.put()));
		Com<IUIAutomationElement> element;
		uia->ElementFromHandle(widget, element.put());
	}
	Com<IUIAutomationElement> root;
	Com<IUIAutomationCondition> any;
	VARIANT document;
	document.vt = VT_I4;
	document.lVal = UIA_DocumentControlTypeId;
	const auto isDocument = propertyCondition(uia, UIA_ControlTypePropertyId, document, PropertyConditionFlags_None);
	if (FAILED(uia->ElementFromHandle(window, root.put())) || !root || FAILED(uia->CreateTrueCondition(any.put())) || !isDocument) return;
	const double deadline = uptime() + 3;
	while (uptime() < deadline) {
		Com<IUIAutomationElement> page;
		Com<IUIAutomationElement> child;
		if (SUCCEEDED(root->FindFirst(TreeScope_Descendants, isDocument.p, page.put())) && page &&
			SUCCEEDED(page->FindFirst(TreeScope_Children, any.p, child.put())) && child) {
			return;
		}
		Sleep(100);
	}
}

std::string find(const Json& request) {
	const DWORD owner = pid(request);
	const RECT target = frame(request);
	const int limit = static_cast<int>(std::clamp(optionalNumber(request, "limit", 50), 1.0, 10000.0));
	const bool offscreen = request["offscreen"] && request["offscreen"]->kind == Json::Bool && request["offscreen"]->boolean;
	const std::wstring query = lowercase(trim(widen(text(request, "text"))));
	const std::string roleQuery = narrow(trim(widen(text(request, "role"))));
	const auto roles = rolesFor(roleQuery, !query.empty());

	IUIAutomation* uia = automation();
	if (!uia) throw Failure{"UI Automation is unavailable"};
	const HWND window = matchWindow(request, owner, target);
	if (!window) throw Failure{"window not found in process " + std::to_string(owner)};
	RECT bounds = target;
	windowBounds(window, bounds);
	wakeChromium(uia, window);

	const auto cache = cacheFor(uia, {UIA_ControlTypePropertyId, UIA_BoundingRectanglePropertyId, UIA_IsOffscreenPropertyId,
		UIA_RuntimeIdPropertyId, UIA_LocalizedControlTypePropertyId, UIA_HeadingLevelPropertyId, UIA_NamePropertyId,
		UIA_FullDescriptionPropertyId, UIA_LegacyIAccessibleDescriptionPropertyId, UIA_ValueValuePropertyId, UIA_HelpTextPropertyId});
	if (!cache) throw Failure{"UI Automation is unavailable"};
	Com<IUIAutomationElement> root;
	if (FAILED(uia->ElementFromHandle(window, root.put())) || !root) {
		throw Failure{"window not found in process " + std::to_string(owner)};
	}

	std::vector<Com<IUIAutomationCondition>> parts;
	if (roles) parts.push_back(roleCondition(uia, *roles));
	if (!query.empty()) parts.push_back(textCondition(uia, query));
	Com<IUIAutomationElementArray> found;
	const auto search = [&](const Com<IUIAutomationCondition>& condition) {
		return condition && SUCCEEDED(root->FindAllBuildCache(TreeScope_Subtree, condition.p, cache.p, found.put())) && found;
	};
	auto condition = combine(uia, parts, true);
	bool searched = search(condition);
	if (!searched && (!query.empty() || (roles && roles->count(kHeadingRole)))) {
		// Older Windows rejects substring or heading conditions; filter here instead. A failure
		// with a plain condition means the tree outran the 2 s transaction timeout.
		Com<IUIAutomationCondition> fallback;
		if (roles) {
			std::set<int> types = *roles;
			if (types.erase(kHeadingRole)) types.insert(UIA_TextControlTypeId);
			fallback = roleCondition(uia, types);
		} else {
			uia->CreateTrueCondition(fallback.put());
		}
		searched = search(fallback);
		condition = std::move(fallback);
	}
	const bool timedOut = !searched;
	int length = 0;
	if (found) found->get_Length(&length);
	const Scope scope = length > 0 ? scopeOf(uia, root.p, condition.p) : Scope();

	std::string elements;
	int count = 0;
	bool truncated = timedOut;
	for (int index = 0; index < length; ++index) {
		Com<IUIAutomationElement> element;
		if (FAILED(found->GetElement(index, element.put())) || !element) continue;
		const int type = cachedInt(element.p, UIA_ControlTypePropertyId, 0);
		if (roles && !roles->count(type) && !(isHeading(element.p) && roles->count(kHeadingRole))) continue;
		std::vector<std::wstring> labels;
		for (const PROPERTYID property : kTextProperties) {
			const std::wstring label = trim(cachedString(element.p, property));
			if (!label.empty()) labels.push_back(label);
		}
		if (!query.empty() && std::none_of(labels.begin(), labels.end(),
				[&](const std::wstring& label) { return lowercase(label).find(query) != std::wstring::npos; })) {
			continue;
		}
		RECT box{};
		element->get_CachedBoundingRectangle(&box);
		const LONG width = box.right - box.left;
		const LONG height = box.bottom - box.top;
		if (box.left <= bounds.left && box.top <= bounds.top && box.right >= bounds.right && box.bottom >= bounds.bottom) continue;
		const POINT centre{box.left + width / 2, box.top + height / 2};
		const std::string key = runtimeKey(element.p);
		const auto clip = key.empty() ? scope.clips.end() : scope.clips.find(key);
		const bool clipped = clip != scope.clips.end();
		const bool visible = width > 1 && height > 1 && PtInRect(&bounds, centre) && (!clipped || PtInRect(&clip->second, centre)) &&
			!cachedBool(element.p, UIA_IsOffscreenPropertyId);
		if (!visible && !(offscreen && std::max(width, height) > 1)) continue;
		if (++count > limit) {
			truncated = true;
			break;
		}
		if (!elements.empty()) elements += ",";
		elements += "{\"role\":" + quote(roleNameOf(element.p)) +
			",\"label\":" + quote(truncateLabel(labels.empty() ? std::wstring() : labels.front())) +
			",\"x\":" + num(box.left) + ",\"y\":" + num(box.top) +
			",\"width\":" + num(width) + ",\"height\":" + num(height);
		if (!key.empty() && scope.web.count(key)) elements += ",\"web\":true";
		if (!visible) {
			elements += ",\"visible\":false";
			if (clipped && !IsRectEmpty(&clip->second)) elements += ",\"container\":{" + boundsFields(clip->second) + "}";
		}
		elements += "}";
	}
	return "\"elements\":[" + elements + "],\"truncated\":" + boolText(truncated);
}

const std::initializer_list<PROPERTYID> kHitProperties = {UIA_NamePropertyId, UIA_FullDescriptionPropertyId,
	UIA_ValueValuePropertyId};

std::string hitFields(IUIAutomationElement* element) {
	RECT box{};
	element->get_CachedBoundingRectangle(&box);
	return "{\"role\":" + quote(roleNameOf(element)) + ",\"label\":" + quote(firstLabel(element, kHitProperties)) + "," +
		boundsFields(box) + "}";
}

// Probed before every press, so "nothing there", "another app's window" and "UIA refused" all
// answer null rather than failing: the caller treats null as inconclusive and presses anyway.
// ElementFromPoint is screen-point based, so the match is scoped to pid here, as on macOS.
std::string elementAt(const Json& request) {
	const DWORD owner = pid(request);
	const POINT spot = point(request, "x", "y");
	const std::string nothing = "\"hit\":null,\"parent\":null";
	IUIAutomation* uia = automation();
	if (!uia) return nothing;
	const auto cache = cacheFor(uia, {UIA_ControlTypePropertyId, UIA_BoundingRectanglePropertyId,
		UIA_ProcessIdPropertyId, UIA_LocalizedControlTypePropertyId, UIA_HeadingLevelPropertyId,
		UIA_NamePropertyId, UIA_FullDescriptionPropertyId, UIA_ValueValuePropertyId});
	Com<IUIAutomationElement> hit;
	Com<IUIAutomationElement> desktop;
	if (!cache || FAILED(uia->ElementFromPointBuildCache(spot, cache.p, hit.put())) || !hit) return nothing;
	// The desktop root and any other app's window both read as nothing, so the three platforms agree.
	const auto belongs = [&](IUIAutomationElement* element) {
		BOOL isDesktop = FALSE;
		if (SUCCEEDED(uia->GetRootElement(desktop.put())) && desktop &&
			SUCCEEDED(uia->CompareElements(element, desktop.p, &isDesktop)) && isDesktop) {
			return false;
		}
		return static_cast<DWORD>(cachedInt(element, UIA_ProcessIdPropertyId, 0)) == owner;
	};
	if (!belongs(hit.p)) return nothing;
	Com<IUIAutomationTreeWalker> walker;
	Com<IUIAutomationElement> parent;
	const bool hasParent = SUCCEEDED(uia->get_ControlViewWalker(walker.put())) && walker &&
		SUCCEEDED(walker->GetParentElementBuildCache(hit.p, cache.p, parent.put())) && parent &&
		belongs(parent.p);
	return "\"hit\":" + hitFields(hit.p) + ",\"parent\":" + (hasParent ? hitFields(parent.p) : "null");
}

// ---- dispatch -------------------------------------------------------------------------------------

bool canPostEvents() {
	const HDESK desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
	if (!desktop) return false;
	wchar_t name[64] = {};
	DWORD length = 0;
	const bool ok = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof name, &length) && _wcsicmp(name, L"Default") == 0;
	CloseDesktop(desktop);
	return ok;
}

void respond(const std::string& id, const std::function<std::string()>& body) {
	try {
		const std::string fields = body();
		send("{\"id\":" + id + ",\"ok\":true" + (fields.empty() ? "" : "," + fields) + "}");
	} catch (const Failure& failure) {
		send("{\"id\":" + id + ",\"ok\":false,\"error\":" + quote(failure.message) + "}");
	} catch (const std::exception& error) {
		send("{\"id\":" + id + ",\"ok\":false,\"error\":" + quote(std::string(error.what())) + "}");
	}
}

class SerialQueue {
public:
	SerialQueue() {
		std::thread([this] {
			CoInitializeEx(nullptr, COINIT_MULTITHREADED);
			while (true) {
				std::function<void()> task;
				{
					std::unique_lock<std::mutex> lock(mutex_);
					ready_.wait(lock, [this] { return !tasks_.empty(); });
					task = std::move(tasks_.front());
					tasks_.pop_front();
				}
				task();
			}
		}).detach();
	}

	void push(std::function<void()> task) {
		{
			std::lock_guard<std::mutex> lock(mutex_);
			tasks_.push_back(std::move(task));
		}
		ready_.notify_one();
	}

private:
	std::mutex mutex_;
	std::condition_variable ready_;
	std::deque<std::function<void()>> tasks_;
};

SerialQueue& inputQueue() {
	static SerialQueue queue;
	return queue;
}

void runInput(const std::string& id, std::function<Action()> prepare) {
	inputQueue().push([id, prepare] {
		respond(id, [&] {
			const Action action = prepare();
			const auto epoch = state.armedToken();
			if (!epoch) throw Failure{"user-input"};
			action(*epoch);
			return std::string();
		});
	});
}

void runWork(const std::string& id, std::function<std::string()> body) {
	std::thread([id, body] {
		CoInitializeEx(nullptr, COINIT_MULTITHREADED);
		respond(id, body);
		CoUninitialize();
	}).detach();
}

void handle(const std::string& line) {
	auto request = std::make_shared<Json>();
	if (!parseJson(line, *request) || request->kind != Json::Object) {
		send("{\"id\":null,\"ok\":false,\"error\":\"invalid request\"}");
		return;
	}
	const Json* idValue = (*request)["id"];
	const std::string id = idValue && idValue->kind == Json::Number ? num(idValue->number) : "null";
	const std::string command = text(*request, "cmd");
	if (command == "move") runInput(id, [request] { return move(*request); });
	else if (command == "click") runInput(id, [request] { return click(*request); });
	else if (command == "drag") runInput(id, [request] { return drag(*request); });
	else if (command == "scroll") runInput(id, [request] { return scroll(*request); });
	else if (command == "type") runInput(id, [request] { return typeText(*request); });
	else if (command == "key") runInput(id, [request] { return key(*request); });
	else if (command == "arm") {
		respond(id, [] {
			arm();
			return std::string();
		});
	} else if (command == "disarm") {
		respond(id, [] {
			disarm();
			return std::string();
		});
	}
	else if (command == "frontmost_window") runWork(id, [] { return frontmostWindow(); });
	else if (command == "window_info") respond(id, [request] { return windowInfo(*request); });
	else if (command == "preflight") {
		respond(id, [] {
			return std::string("\"postEvents\":") + boolText(canPostEvents()) + ",\"accessibility\":" + boolText(automation() != nullptr);
		});
	} else if (command == "cursor") {
		respond(id, [] {
			const POINT location = cursorLocation();
			return "\"x\":" + num(location.x) + ",\"y\":" + num(location.y);
		});
	} else if (command == "raise") runWork(id, [request] { return raise(*request); });
	else if (command == "set_bounds") runWork(id, [request] { return setBounds(*request); });
	else if (command == "find") runWork(id, [request] { return find(*request); });
	else if (command == "at") runWork(id, [request] { return elementAt(*request); });
	else send("{\"id\":" + id + ",\"ok\":false,\"error\":" + quote("unknown command: " + command) + "}");
}

BOOL WINAPI consoleClosed(DWORD) { releaseAndExit(); }

}  // namespace

int main() {
	if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) SetProcessDPIAware();
	CoInitializeEx(nullptr, COINIT_MULTITHREADED);
	timeBeginPeriod(1);
	driftLimit = 8.0 * GetDpiForSystem() / 96.0;  // 8 points, like macOS; ponytail: primary-monitor DPI only
	stdoutHandle = GetStdHandle(STD_OUTPUT_HANDLE);
	SetConsoleCtrlHandler(consoleClosed, TRUE);

	const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
	std::string pending;
	char buffer[65536];
	DWORD read = 0;
	while (ReadFile(input, buffer, sizeof buffer, &read, nullptr) && read > 0) {
		pending.append(buffer, read);
		size_t start = 0;
		size_t newline = 0;
		while ((newline = pending.find('\n', start)) != std::string::npos) {
			std::string line = pending.substr(start, newline - start);
			start = newline + 1;
			if (!line.empty() && line.back() == '\r') line.pop_back();
			if (line.find_first_not_of(" \t") != std::string::npos) handle(line);
		}
		pending.erase(0, start);
	}
	releaseAndExit();
}
