#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <node_api.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static napi_threadsafe_function g_tsfn = NULL;
static CFMachPortRef g_tap = NULL;
static CFRunLoopSourceRef g_source = NULL;
static CGEventFlags g_modifier_flags = 0;

static void emit_key_line(const char *line) {
	if (!line) {
		return;
	}
	if (g_tsfn) {
		char *copy = strdup(line);
		if (copy) {
			napi_call_threadsafe_function(g_tsfn, copy, napi_tsfn_nonblocking);
		}
		return;
	}
	printf("%s\n", line);
	fflush(stdout);
}

static bool string_contains_ci(CFStringRef value, CFStringRef needle) {
	if (!value || !needle) {
		return false;
	}
	CFRange range = CFStringFind(value, needle, kCFCompareCaseInsensitive);
	return range.location != kCFNotFound;
}

typedef enum {
	FOCUSED_FIELD_NON_SECURE = 0,
	FOCUSED_FIELD_SECURE = 1,
	FOCUSED_FIELD_UNKNOWN = 2,
} focused_field_kind;

static CFStringRef copy_ax_string(AXUIElementRef element, CFStringRef attribute) {
	CFTypeRef value = NULL;
	if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) {
		return NULL;
	}
	if (CFGetTypeID(value) == CFStringGetTypeID()) {
		return (CFStringRef)value;
	}
	CFRelease(value);
	return NULL;
}

static focused_field_kind element_security_kind(AXUIElementRef element) {
	CFStringRef role = copy_ax_string(element, kAXRoleAttribute);
	CFStringRef subrole = copy_ax_string(element, kAXSubroleAttribute);
	if (!role && !subrole) {
		return FOCUSED_FIELD_UNKNOWN;
	}
	const bool secure =
		string_contains_ci(subrole, CFSTR("secure")) ||
		string_contains_ci(subrole, CFSTR("password")) ||
		string_contains_ci(role, CFSTR("secure")) ||
		string_contains_ci(role, CFSTR("password"));
	if (role) {
		CFRelease(role);
	}
	if (subrole) {
		CFRelease(subrole);
	}
	return secure ? FOCUSED_FIELD_SECURE : FOCUSED_FIELD_NON_SECURE;
}

static focused_field_kind focused_element_security_kind(void) {
	AXUIElementRef system_wide = AXUIElementCreateSystemWide();
	if (!system_wide) {
		return FOCUSED_FIELD_UNKNOWN;
	}

	CFTypeRef focused = NULL;
	AXError focused_error = AXUIElementCopyAttributeValue(
		system_wide,
		kAXFocusedUIElementAttribute,
		&focused
	);
	CFRelease(system_wide);

	if (focused_error != kAXErrorSuccess || !focused || CFGetTypeID(focused) != AXUIElementGetTypeID()) {
		if (focused) {
			CFRelease(focused);
		}
		return FOCUSED_FIELD_UNKNOWN;
	}

	AXUIElementRef current = (AXUIElementRef)focused;
	focused_field_kind result = FOCUSED_FIELD_NON_SECURE;
	for (int depth = 0; current && depth < 6; depth += 1) {
		focused_field_kind kind = element_security_kind(current);
		if (kind != FOCUSED_FIELD_NON_SECURE) {
			result = kind;
			break;
		}
		CFTypeRef parent = NULL;
		AXError parent_error = AXUIElementCopyAttributeValue(current, kAXParentAttribute, &parent);
		if (parent_error != kAXErrorSuccess || !parent || CFGetTypeID(parent) != AXUIElementGetTypeID()) {
			if (parent) {
				CFRelease(parent);
			}
			if (parent_error != kAXErrorSuccess &&
				parent_error != kAXErrorNoValue &&
				parent_error != kAXErrorAttributeUnsupported) {
				result = FOCUSED_FIELD_UNKNOWN;
			}
			break;
		}
		CFRelease(current);
		current = (AXUIElementRef)parent;
	}
	if (current) {
		CFRelease(current);
	}
	return result;
}

static const char *key_name(CGKeyCode key_code) {
	switch (key_code) {
	case 36:
	case 76:
		return "Enter";
	case 53:
		return "Escape";
	case 48:
		return "Tab";
	case 51:
		return "Backspace";
	case 117:
		return "Delete";
	case 49:
		return "Space";
	case 126:
		return "ArrowUp";
	case 125:
		return "ArrowDown";
	case 123:
		return "ArrowLeft";
	case 124:
		return "ArrowRight";
	case 115:
		return "Home";
	case 119:
		return "End";
	case 116:
		return "PageUp";
	case 121:
		return "PageDown";
	case 114:
		return "Insert";
	case 122:
		return "F1";
	case 120:
		return "F2";
	case 99:
		return "F3";
	case 118:
		return "F4";
	case 96:
		return "F5";
	case 97:
		return "F6";
	case 98:
		return "F7";
	case 100:
		return "F8";
	case 101:
		return "F9";
	case 109:
		return "F10";
	case 103:
		return "F11";
	case 111:
		return "F12";
	case 0:
		return "A";
	case 11:
		return "B";
	case 8:
		return "C";
	case 2:
		return "D";
	case 14:
		return "E";
	case 3:
		return "F";
	case 5:
		return "G";
	case 4:
		return "H";
	case 34:
		return "I";
	case 38:
		return "J";
	case 40:
		return "K";
	case 37:
		return "L";
	case 46:
		return "M";
	case 45:
		return "N";
	case 31:
		return "O";
	case 35:
		return "P";
	case 12:
		return "Q";
	case 15:
		return "R";
	case 1:
		return "S";
	case 17:
		return "T";
	case 32:
		return "U";
	case 9:
		return "V";
	case 13:
		return "W";
	case 7:
		return "X";
	case 16:
		return "Y";
	case 6:
		return "Z";
	case 18:
		return "1";
	case 19:
		return "2";
	case 20:
		return "3";
	case 21:
		return "4";
	case 22:
		return "5";
	case 23:
		return "6";
	case 26:
		return "7";
	case 28:
		return "8";
	case 25:
		return "9";
	case 29:
		return "0";
	case 24:
		return "Equal";
	case 27:
		return "Minus";
	case 33:
		return "[";
	case 30:
		return "]";
	case 42:
		return "\\";
	case 41:
		return ";";
	case 39:
		return "'";
	case 43:
		return ",";
	case 47:
		return ".";
	case 44:
		return "/";
	case 50:
		return "`";
	case 105:
		return "F13";
	case 107:
		return "F14";
	case 113:
		return "F15";
	case 106:
		return "F16";
	case 64:
		return "F17";
	case 79:
		return "F18";
	case 80:
		return "F19";
	case 56:
	case 60:
		return "Shift";
	case 59:
	case 62:
		return "Control";
	case 58:
	case 61:
		return "Alt";
	case 55:
	case 54:
		return "Meta";
	default:
		return NULL;
	}
}

static CGEventRef tap_callback(
	CGEventTapProxy proxy,
	CGEventType type,
	CGEventRef event,
	void *user_info
) {
	(void)proxy;
	(void)user_info;

	if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
		if (g_tap) {
			CGEventTapEnable(g_tap, true);
		}
		return event;
	}
	if (type == kCGEventFlagsChanged) {
		g_modifier_flags = CGEventGetFlags(event);
		return event;
	}
	if (type != kCGEventKeyDown) {
		return event;
	}
	const focused_field_kind field_kind = focused_element_security_kind();
	if (field_kind == FOCUSED_FIELD_SECURE) {
		return event;
	}

	const CGKeyCode key_code = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
	const CGEventFlags flags = CGEventGetFlags(event) | g_modifier_flags;
	char fallback[32];
	const char *name = key_name(key_code);
	if (!name) {
		snprintf(fallback, sizeof(fallback), "Key%u", (unsigned)key_code);
		name = fallback;
	}

	char modifiers[64] = {0};
	if (flags & kCGEventFlagMaskControl) {
		strcat(modifiers, modifiers[0] ? ",ctrl" : "ctrl");
	}
	if (flags & kCGEventFlagMaskAlternate) {
		strcat(modifiers, modifiers[0] ? ",alt" : "alt");
	}
	if (flags & kCGEventFlagMaskShift) {
		strcat(modifiers, modifiers[0] ? ",shift" : "shift");
	}
	if (flags & kCGEventFlagMaskCommand) {
		strcat(modifiers, modifiers[0] ? ",meta" : "meta");
	}
	if (CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat) != 0) {
		strcat(modifiers, modifiers[0] ? ",repeat" : "repeat");
	}

	char line[160];
	if (modifiers[0]) {
		snprintf(line, sizeof(line), "KEY:down:%s:%s", name, modifiers);
	} else {
		snprintf(line, sizeof(line), "KEY:down:%s", name);
	}
	emit_key_line(line);
	return event;
}

static void *watch_stdin(void *arg) {
	(void)arg;
	char line[32];
	while (fgets(line, sizeof(line), stdin)) {
		if (strncmp(line, "stop", 4) == 0) {
			_exit(0);
		}
	}
	_exit(0);
	return NULL;
}

int main(int argc, const char **argv) {
	const int probe = argc > 1 && strcmp(argv[1], "--probe") == 0;
	const CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventFlagsChanged);
	CFMachPortRef tap = CGEventTapCreate(
		kCGSessionEventTap,
		kCGHeadInsertEventTap,
		kCGEventTapOptionListenOnly,
		mask,
		tap_callback,
		NULL
	);
	if (!tap) {
		fputs("Keystroke event tap unavailable\n", stderr);
		if (probe) {
			printf("TAP:fail\n");
			fflush(stdout);
		}
		return 1;
	}
	if (probe) {
		printf("TAP:ok\n");
		fflush(stdout);
		CFRelease(tap);
		return 0;
	}

	CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
	CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
	CGEventTapEnable(tap, true);

	pthread_t stdin_thread;
	pthread_create(&stdin_thread, NULL, watch_stdin, NULL);
	pthread_detach(stdin_thread);

	CFRunLoopRun();
	CFRelease(source);
	CFRelease(tap);
	return 0;
}

static void call_js_key_line(napi_env env, napi_value js_callback, void *context, void *data) {
	(void)context;
	char *line = (char *)data;
	if (env == NULL || js_callback == NULL) {
		free(line);
		return;
	}
	napi_value argv[1];
	napi_create_string_utf8(env, line ? line : "", NAPI_AUTO_LENGTH, &argv[0]);
	napi_value global;
	napi_get_global(env, &global);
	napi_call_function(env, global, js_callback, 1, argv, NULL);
	free(line);
}

static void native_stop_tap(void) {
	g_modifier_flags = 0;
	if (g_tap) {
		CGEventTapEnable(g_tap, false);
	}
	if (g_source) {
		CFRunLoopRemoveSource(CFRunLoopGetMain(), g_source, kCFRunLoopCommonModes);
		CFRelease(g_source);
		g_source = NULL;
	}
	if (g_tap) {
		CFRelease(g_tap);
		g_tap = NULL;
	}
	if (g_tsfn) {
		napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
		g_tsfn = NULL;
	}
}

static napi_value Start(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1];
	napi_get_cb_info(env, info, &argc, args, NULL, NULL);

	napi_value result;
	if (argc < 1) {
		napi_get_boolean(env, false, &result);
		return result;
	}

	native_stop_tap();

	napi_value resource_name;
	napi_create_string_utf8(env, "recordly-keystroke-tap", NAPI_AUTO_LENGTH, &resource_name);
	napi_status tsfn_status = napi_create_threadsafe_function(
		env,
		args[0],
		NULL,
		resource_name,
		0,
		1,
		NULL,
		NULL,
		NULL,
		call_js_key_line,
		&g_tsfn
	);
	if (tsfn_status != napi_ok) {
		napi_get_boolean(env, false, &result);
		return result;
	}

	const CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventFlagsChanged);
	g_tap = CGEventTapCreate(
		kCGSessionEventTap,
		kCGHeadInsertEventTap,
		kCGEventTapOptionListenOnly,
		mask,
		tap_callback,
		NULL
	);
	if (!g_tap) {
		native_stop_tap();
		napi_get_boolean(env, false, &result);
		return result;
	}

	g_source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
	CFRunLoopAddSource(CFRunLoopGetMain(), g_source, kCFRunLoopCommonModes);
	CGEventTapEnable(g_tap, true);
	napi_get_boolean(env, true, &result);
	return result;
}

static napi_value Stop(napi_env env, napi_callback_info info) {
	(void)info;
	native_stop_tap();
	napi_value result;
	napi_get_boolean(env, true, &result);
	return result;
}

static napi_value Init(napi_env env, napi_value exports) {
	napi_value start_fn;
	napi_value stop_fn;
	napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, NULL, &start_fn);
	napi_create_function(env, "stop", NAPI_AUTO_LENGTH, Stop, NULL, &stop_fn);
	napi_set_named_property(env, exports, "start", start_fn);
	napi_set_named_property(env, exports, "stop", stop_fn);
	return exports;
}

NAPI_MODULE(recordly_keystroke_tap, Init)
