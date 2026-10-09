#define _GNU_SOURCE
#include <X11/XKBlib.h>
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XInput2.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <dlfcn.h>
#include <errno.h>
#include <math.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define WAYLAND_MESSAGE "Mouse and keyboard control needs an X11 session on Linux; Wayland is not supported yet."
#define DRIFT_LIMIT 8.0
#define DRIFT_WINDOW 1.0
#define EXPECT_SECONDS 2.0
#define PIXELS_PER_NOTCH 50.0
#define FIND_SECONDS 3.0
#define FIND_NODES 20000
#define TRY(x) do { if (!(x)) return false; } while (0)

typedef struct { char *s; size_t n, cap; } Buf;

static void b_add(Buf *b, const char *s, size_t n) {
	if (b->n + n + 1 > b->cap) {
		b->cap = (b->n + n + 1) * 2;
		if (!(b->s = realloc(b->s, b->cap))) abort();
	}
	memcpy(b->s + b->n, s, n);
	b->n += n;
	b->s[b->n] = 0;
}

static void b_puts(Buf *b, const char *s) { b_add(b, s, strlen(s)); }

static void b_printf(Buf *b, const char *fmt, ...) {
	char tmp[512];
	va_list ap;
	va_start(ap, fmt);
	int n = vsnprintf(tmp, sizeof tmp, fmt, ap);
	va_end(ap);
	if (n > 0) b_add(b, tmp, (size_t)n < sizeof tmp ? (size_t)n : sizeof tmp - 1);
}

static void b_str(Buf *b, const char *s) {
	b_puts(b, "\"");
	for (; s && *s; s++) {
		unsigned char c = (unsigned char)*s;
		if (c == '"' || c == '\\') b_add(b, (char[]){'\\', (char)c}, 2);
		else if (c < 0x20) b_printf(b, "\\u%04x", c);
		else b_add(b, (const char *)&c, 1);
	}
	b_puts(b, "\"");
}

static void b_num(Buf *b, double v) { b_printf(b, "%.15g", isfinite(v) ? v : 0); }

static void b_utf8(Buf *b, unsigned cp) {
	char o[4];
	int n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
	if (n == 1) o[0] = (char)cp;
	else {
		for (int i = n - 1; i > 0; i--, cp >>= 6) o[i] = (char)(0x80 | (cp & 0x3F));
		o[0] = (char)((0xF00 >> n) | cp);
	}
	b_add(b, o, n);
}

static unsigned utf8_next(const char **p) {
	const unsigned char *s = (const unsigned char *)*p;
	unsigned cp = s[0];
	int n = cp < 0x80 ? 0 : cp >= 0xF0 ? 3 : cp >= 0xE0 ? 2 : cp >= 0xC0 ? 1 : -1;
	if (n < 0) return (*p)++, 0xFFFD;
	cp &= n ? 0x3Fu >> n : 0x7Fu;
	for (int i = 1; i <= n; i++) {
		if ((s[i] & 0xC0) != 0x80) return (*p)++, 0xFFFD;
		cp = cp << 6 | (s[i] & 0x3F);
	}
	*p += n + 1;
	return cp;
}

static _Thread_local char err_msg[600];

static bool fail(const char *fmt, ...) {
	va_list ap;
	va_start(ap, fmt);
	vsnprintf(err_msg, sizeof err_msg, fmt, ap);
	va_end(ap);
	return false;
}

static double now(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec + ts.tv_nsec / 1e9;
}

static void sleep_s(double s) {
	if (s <= 0) return;
	struct timespec ts = {(time_t)s, (long)((s - (time_t)s) * 1e9)};
	while (nanosleep(&ts, &ts) == -1 && errno == EINTR) {}
}

typedef enum { J_NULL, J_FALSE, J_TRUE, J_NUM, J_STR, J_ARR, J_OBJ } JType;
typedef struct Json { JType t; double num; char *str; int len; char **keys; struct Json **vals; } Json;

static void j_free(Json *j) {
	if (!j) return;
	for (int i = 0; i < j->len; i++) {
		free(j->keys[i]);
		j_free(j->vals[i]);
	}
	free(j->str);
	free(j->keys);
	free(j->vals);
	free(j);
}

static void j_ws(const char **p) {
	while (**p == ' ' || **p == '\t' || **p == '\r' || **p == '\n') (*p)++;
}

static int hex4(const char *p) {
	int v = 0;
	for (int i = 0; i < 4; i++) {
		char c = p[i];
		v <<= 4;
		if (c >= '0' && c <= '9') v |= c - '0';
		else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
		else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
		else return -1;
	}
	return v;
}

static char *j_string(const char **p) {
	Buf b = {0};
	b_add(&b, "", 0);
	for ((*p)++; **p != '"';) {
		unsigned char c = (unsigned char)**p;
		if (c < 0x20) goto bad;
		if (c != '\\') {
			b_add(&b, (*p)++, 1);
			continue;
		}
		char e = (*p)[1];
		if (!e) goto bad;
		*p += 2;
		const char *plain = strchr("\"\\/bfnrt", e);
		if (plain) {
			b_add(&b, &"\"\\/\b\f\n\r\t"[plain - "\"\\/bfnrt"], 1);
			continue;
		}
		int cp = e == 'u' ? hex4(*p) : -1;
		if (cp < 0) goto bad;
		*p += 4;
		if (cp >= 0xD800 && cp < 0xDC00 && (*p)[0] == '\\' && (*p)[1] == 'u') {
			int lo = hex4(*p + 2);
			if (lo >= 0xDC00 && lo < 0xE000) {
				cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
				*p += 6;
			}
		}
		b_utf8(&b, (unsigned)cp);
	}
	(*p)++;
	return b.s;
bad:
	free(b.s);
	return NULL;
}

static Json *j_value(const char **p, int depth) {
	j_ws(p);
	if (depth > 64) return NULL;
	Json *j = calloc(1, sizeof *j);
	char c = **p;
	if (c == '{' || c == '[') {
		j->t = c == '{' ? J_OBJ : J_ARR;
		char close = c == '{' ? '}' : ']';
		(*p)++;
		j_ws(p);
		if (**p == close) return (*p)++, j;
		for (;;) {
			char *key = NULL;
			if (j->t == J_OBJ) {
				j_ws(p);
				if (**p != '"' || !(key = j_string(p))) goto bad;
				j_ws(p);
				if (**p != ':') {
					free(key);
					goto bad;
				}
				(*p)++;
			}
			Json *v = j_value(p, depth + 1);
			if (!v) {
				free(key);
				goto bad;
			}
			j->keys = realloc(j->keys, (j->len + 1) * sizeof *j->keys);
			j->vals = realloc(j->vals, (j->len + 1) * sizeof *j->vals);
			j->keys[j->len] = key;
			j->vals[j->len++] = v;
			j_ws(p);
			if (**p == ',') {
				(*p)++;
				continue;
			}
			if (**p == close) return (*p)++, j;
			goto bad;
		}
	}
	if (c == '"') {
		j->t = J_STR;
		if ((j->str = j_string(p))) return j;
	} else if (!strncmp(*p, "true", 4)) {
		j->t = J_TRUE;
		*p += 4;
		return j;
	} else if (!strncmp(*p, "false", 5)) {
		j->t = J_FALSE;
		*p += 5;
		return j;
	} else if (!strncmp(*p, "null", 4)) {
		*p += 4;
		return j;
	} else if (c == '-' || (c >= '0' && c <= '9')) {
		char *end;
		j->num = strtod(*p, &end);
		if (end != *p) {
			*p = end;
			j->t = J_NUM;
			return j;
		}
	}
bad:
	j_free(j);
	return NULL;
}

static Json *j_get(Json *o, const char *k) {
	for (int i = 0; o && o->t == J_OBJ && i < o->len; i++)
		if (!strcmp(o->keys[i], k)) return o->vals[i];
	return NULL;
}

static const char *j_str(Json *o, const char *k) {
	Json *v = j_get(o, k);
	return v && v->t == J_STR ? v->str : NULL;
}

static bool j_num(Json *o, const char *k, double *out) {
	Json *v = j_get(o, k);
	if (!v || v->t != J_NUM || !isfinite(v->num)) return false;
	*out = v->num;
	return true;
}

static double j_opt(Json *o, const char *k, double fallback) {
	double v;
	return j_num(o, k, &v) ? v : fallback;
}

static bool need_num(Json *r, const char *k, double *out) { return j_num(r, k, out) || fail("missing or invalid %s", k); }

static bool point(Json *r, const char *xk, const char *yk, double *x, double *y) {
	TRY(need_num(r, xk, x) && need_num(r, yk, y));
	*x = fmin(fmax(*x, -32768), 32767);
	*y = fmin(fmax(*y, -32768), 32767);
	return true;
}

static bool integer(Json *r, const char *k, int fallback, int lo, int hi, int *out) {
	double v = j_opt(r, k, fallback);
	if (v != floor(v) || v < lo || v > hi) return fail("%s must be a whole number from %d to %d", k, lo, hi);
	*out = (int)v;
	return true;
}

static double ms_of(Json *r, double fallback) { return fmin(fmax(j_opt(r, "ms", fallback), 0), 600000); }

static bool need_frame(Json *r, double f[4]) {
	Json *fr = j_get(r, "frame");
	if (!fr || fr->t != J_OBJ) return fail("missing frame");
	return need_num(fr, "x", &f[0]) && need_num(fr, "y", &f[1]) && need_num(fr, "width", &f[2]) &&
		need_num(fr, "height", &f[3]);
}

static bool need_pid(Json *r, int *pid) {
	double v;
	if (!j_num(r, "pid", &v) || v < 1 || v > 2147483647) return fail("missing or invalid pid");
	*pid = (int)v;
	return true;
}

static Window window_id(Json *r) {
	double v;
	return j_num(r, "windowId", &v) && v >= 1 && v <= 4294967295.0 ? (Window)v : 0;
}

static bool near(const double a[4], const double b[4], double tolerance) {
	for (int i = 0; i < 4; i++)
		if (fabs(a[i] - b[i]) > tolerance) return false;
	return true;
}

static pthread_mutex_t out_lock = PTHREAD_MUTEX_INITIALIZER;
static void release_and_exit(void) __attribute__((noreturn));

static void send_buf(Buf *b) {
	b_add(b, "\n", 1);
	pthread_mutex_lock(&out_lock);
	for (size_t off = 0; off < b->n;) {
		ssize_t w = write(STDOUT_FILENO, b->s + off, b->n - off);
		if (w < 0 && errno == EINTR) continue;
		if (w <= 0) release_and_exit();
		off += (size_t)w;
	}
	pthread_mutex_unlock(&out_lock);
	free(b->s);
}

static void reply(const char *id, bool ok, Buf *body) {
	Buf b = {0};
	b_printf(&b, "{\"id\":%s,\"ok\":%s", id, ok ? "true" : "false");
	if (ok && body && body->n) b_add(&b, body->s, body->n);
	if (!ok) {
		b_puts(&b, ",\"error\":");
		b_str(&b, err_msg);
	}
	b_puts(&b, "}");
	if (body) free(body->s);
	send_buf(&b);
}

static Display *in_dpy, *sync_dpy, *mon_dpy;
static bool have_xtest, have_xi2, wayland_session;
static int xi_opcode, xi_minor;
static _Thread_local int x_error;

static int on_x_error(Display *d, XErrorEvent *e) {
	(void)d;
	x_error = e->error_code ? e->error_code : 1;
	return 0;
}

static void drain(Display *d) {
	while (XPending(d)) {
		XEvent e;
		XNextEvent(d, &e);
		if (e.type == MappingNotify) XRefreshKeyboardMapping(&e.xmapping);
	}
}

static void cursor(Display *d, double *x, double *y) {
	Window root, child;
	int rx = 0, ry = 0, wx, wy;
	unsigned mask;
	XQueryPointer(d, DefaultRootWindow(d), &root, &child, &rx, &ry, &wx, &wy, &mask);
	*x = rx;
	*y = ry;
}

/*
 * Takeover. XTest events cannot carry a tag, but XInput2 raw events name the slave device that produced them,
 * and everything injected through XTest arrives from an "XTEST" slave. Events from any other slave are a real
 * device and always count as the user. For XTEST events (ours, or another XTest client such as xdotool or a
 * VNC server) every event we post is first recorded in this ledger, and a raw event that matches a recent entry
 * (same kind and keycode/button, or the same absolute pointer position) is consumed as ours. Anything left
 * over is someone else.
 */
enum { E_MOTION, E_KEY_DOWN, E_KEY_UP, E_BUTTON_DOWN, E_BUTTON_UP };
typedef struct { int type, detail, x, y; double t; } Expect;
#define LEDGER_CAP 4096
static Expect ledger[LEDGER_CAP];
static int ledger_head, ledger_len;
static pthread_mutex_t ledger_lock = PTHREAD_MUTEX_INITIALIZER;

static void expect(int type, int detail, int x, int y) {
	pthread_mutex_lock(&ledger_lock);
	if (ledger_len == LEDGER_CAP) {
		ledger_head = (ledger_head + 1) % LEDGER_CAP;
		ledger_len--;
	}
	ledger[(ledger_head + ledger_len++) % LEDGER_CAP] = (Expect){type, detail, x, y, now()};
	pthread_mutex_unlock(&ledger_lock);
}

static bool expected(int type, int detail, double x, double y) {
	pthread_mutex_lock(&ledger_lock);
	double t = now();
	while (ledger_len && t - ledger[ledger_head].t > EXPECT_SECONDS) {
		ledger_head = (ledger_head + 1) % LEDGER_CAP;
		ledger_len--;
	}
	bool found = false;
	for (int i = 0; i < ledger_len && !found; i++) {
		Expect *e = &ledger[(ledger_head + i) % LEDGER_CAP];
		if (e->type != type) continue;
		if (type == E_MOTION ? fabs(e->x - x) > 0.5 || fabs(e->y - y) > 0.5 : e->detail != detail) continue;
		for (int k = i; k + 1 < ledger_len; k++)
			ledger[(ledger_head + k) % LEDGER_CAP] = ledger[(ledger_head + k + 1) % LEDGER_CAP];
		ledger_len--;
		found = true;
	}
	pthread_mutex_unlock(&ledger_lock);
	return found;
}

static void post_key(unsigned code, bool down) {
	expect(down ? E_KEY_DOWN : E_KEY_UP, (int)code, 0, 0);
	XTestFakeKeyEvent(in_dpy, code, down, CurrentTime);
	XFlush(in_dpy);
}

static void post_button(unsigned button, bool down) {
	expect(down ? E_BUTTON_DOWN : E_BUTTON_UP, (int)button, 0, 0);
	XTestFakeButtonEvent(in_dpy, button, down, CurrentTime);
	XFlush(in_dpy);
}

static void post_motion(int x, int y) {
	expect(E_MOTION, 0, x, y);
	XTestFakeMotionEvent(in_dpy, -1, x, y, CurrentTime);
	XFlush(in_dpy);
}

static pthread_mutex_t st_lock = PTHREAD_MUTEX_INITIALIZER;
static long epoch, armed_epoch = -1;
static double last_emit, drift, drift_start, ptr_x, ptr_y;

static long current_epoch(void) {
	pthread_mutex_lock(&st_lock);
	long e = epoch;
	pthread_mutex_unlock(&st_lock);
	return e;
}

static bool begin(long *out) {
	pthread_mutex_lock(&st_lock);
	bool ok = armed_epoch == epoch;
	*out = epoch;
	pthread_mutex_unlock(&st_lock);
	return ok || fail("user-input");
}

static void set_armed(bool armed, double x, double y) {
	pthread_mutex_lock(&st_lock);
	if (armed) {
		armed_epoch = epoch;
		drift = 0;
		drift_start = now();
		ptr_x = x;
		ptr_y = y;
	} else {
		epoch++;
		armed_epoch = -1;
	}
	pthread_mutex_unlock(&st_lock);
}

static void user_input_locked(const char *kind, bool escape) {
	if (armed_epoch < 0) return;
	bool first = armed_epoch == epoch;
	epoch++;
	double t = now();
	if (first || escape || t - last_emit >= 0.25) {
		last_emit = t;
		Buf b = {0};
		b_printf(&b, "{\"event\":\"user-input\",\"kind\":\"%s\",\"escape\":%s}", kind, escape ? "true" : "false");
		send_buf(&b);
	}
}

static void user_input(const char *kind, bool escape) {
	pthread_mutex_lock(&st_lock);
	user_input_locked(kind, escape);
	pthread_mutex_unlock(&st_lock);
}

static void pointer_moved_locked(double distance) {
	double t = now();
	if (t - drift_start > DRIFT_WINDOW) {
		drift = 0;
		drift_start = t;
	}
	drift += distance;
	if (drift > DRIFT_LIMIT) user_input_locked("move", false);
}

typedef struct { int id; bool button; unsigned code; } Held;
static Held held[64];
static int held_count, held_next;
static bool held_stopped;
static pthread_mutex_t held_lock = PTHREAD_MUTEX_INITIALIZER;

static void post_held(Held h, bool down) {
	if (h.button) post_button(h.code, down);
	else post_key(h.code, down);
}

static int press(bool button, unsigned code) {
	pthread_mutex_lock(&held_lock);
	int id = 0;
	if (held_stopped) fail("Recordly's input helper is stopping");
	else if (held_count == 64) fail("too many keys and buttons are held");
	else {
		Held h = {++held_next, button, code};
		post_held(h, true);
		held[held_count++] = h;
		id = h.id;
	}
	pthread_mutex_unlock(&held_lock);
	return id;
}

static void release(int id) {
	pthread_mutex_lock(&held_lock);
	for (int i = 0; i < held_count; i++) {
		if (held[i].id != id) continue;
		post_held(held[i], false);
		memmove(&held[i], &held[i + 1], (held_count - i - 1) * sizeof *held);
		held_count--;
		break;
	}
	pthread_mutex_unlock(&held_lock);
}

static void release_all(bool stop) {
	pthread_mutex_lock(&held_lock);
	if (stop) held_stopped = true;
	while (held_count) post_held(held[--held_count], false);
	if (in_dpy) XSync(in_dpy, False);
	pthread_mutex_unlock(&held_lock);
}

static bool check_abort(long e) { return current_epoch() == e || fail("user-input"); }

static bool pause_until(double deadline, long e) {
	for (;;) {
		TRY(check_abort(e));
		double left = deadline - now();
		if (left <= 0) return true;
		sleep_s(fmin(left, 0.01));
	}
}

static bool pause_ms(double ms, long e) { return pause_until(now() + ms / 1000, e); }

static double ease(double t) { return t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2; }

static bool glide(double tx, double ty, double ms, long e) {
	TRY(check_abort(e));
	double sx, sy;
	cursor(in_dpy, &sx, &sy);
	int steps = ms > 0 ? (int)fmax(1, round(ms * 120 / 1000)) : 1;
	double start = now();
	for (int i = 1; i <= steps; i++) {
		TRY(check_abort(e));
		double p = ease((double)i / steps);
		post_motion((int)lround(sx + (tx - sx) * p), (int)lround(sy + (ty - sy) * p));
		TRY(pause_until(start + ms / 1000 * i / steps, e));
	}
	return true;
}

static bool approach(double x, double y, long e) {
	double cx, cy;
	cursor(in_dpy, &cx, &cy);
	return hypot(cx - x, cy - y) <= 2 || glide(x, y, 300, e);
}

enum { M_CTRL = 1, M_ALT = 2, M_SHIFT = 4, M_CMD = 8, M_FN = 16, M_LEVEL3 = 32 };
static const struct { const char *name; unsigned bit; KeySym syms[3]; } mod_keys[] = {
	{"ctrl", M_CTRL, {XK_Control_L, XK_Control_R, 0}},
	{"alt", M_ALT, {XK_Alt_L, XK_Alt_R, XK_Meta_L}},
	{"shift", M_SHIFT, {XK_Shift_L, XK_Shift_R, 0}},
	{"cmd", M_CMD, {XK_Super_L, XK_Super_R, XK_Meta_L}},
	{"fn", M_FN, {0, 0, 0}},
	{"level3", M_LEVEL3, {XK_ISO_Level3_Shift, XK_Mode_switch, 0}},
};

static bool modifiers(Json *r, unsigned *out) {
	*out = 0;
	Json *m = j_get(r, "modifiers");
	for (int i = 0; m && m->t == J_ARR && i < m->len; i++) {
		const char *name = m->vals[i]->t == J_STR ? m->vals[i]->str : "";
		unsigned bit = 0;
		for (int k = 0; k < 5; k++)
			if (!strcmp(name, mod_keys[k].name)) bit = mod_keys[k].bit;
		if (!bit) return fail("unknown modifier: %s. Use cmd, shift, alt, ctrl or fn", name);
		*out |= bit;
	}
	return true;
}

typedef struct { int ids[8]; int n; bool settle; } Hold;

static bool hold(unsigned mods, long e, bool settle, Hold *h) {
	h->n = 0;
	h->settle = settle;
	for (int k = 0; k < 6; k++) {
		if (!(mods & mod_keys[k].bit) || !mod_keys[k].syms[0]) continue;
		TRY(check_abort(e));
		KeyCode code = 0;
		for (int s = 0; s < 3 && !code && mod_keys[k].syms[s]; s++) code = XKeysymToKeycode(in_dpy, mod_keys[k].syms[s]);
		if (!code) return fail("the %s key is not on this keyboard layout", mod_keys[k].name);
		int id = press(false, code);
		TRY(id);
		h->ids[h->n++] = id;
	}
	return !h->n || !settle || pause_ms(15, e);
}

static void unhold(Hold *h) {
	if (h->n && h->settle) sleep_s(0.015);
	while (h->n) release(h->ids[--h->n]);
}

static bool button_of(Json *r, unsigned *b) {
	const char *s = j_str(r, "button");
	if (!s || !strcmp(s, "left")) *b = 1;
	else if (!strcmp(s, "right")) *b = 3;
	else if (!strcmp(s, "middle")) *b = 2;
	else return fail("unknown button: %s", s);
	return true;
}

static bool cmd_move(Json *r) {
	double x, y;
	long e;
	TRY(point(r, "x", "y", &x, &y));
	double ms = ms_of(r, 0);
	TRY(begin(&e));
	return glide(x, y, ms, e);
}

static bool cmd_click(Json *r) {
	double x, y;
	unsigned button, mods;
	int count;
	long e;
	TRY(point(r, "x", "y", &x, &y) && button_of(r, &button) && modifiers(r, &mods));
	TRY(integer(r, "count", 1, 1, 3, &count));
	double ms = ms_of(r, 0);
	TRY(begin(&e));
	TRY(glide(x, y, ms, e) && pause_ms(250, e));
	Hold h;
	TRY(hold(mods, e, true, &h));
	for (int i = 1; i <= count; i++) {
		if (i > 1) TRY(pause_ms(90, e));
		TRY(check_abort(e));
		int id = press(true, button);
		TRY(id);
		sleep_s(0.06);
		release(id);
	}
	unhold(&h);
	return true;
}

static bool cmd_drag(Json *r) {
	double fx, fy, tx, ty;
	unsigned button, mods;
	long e;
	TRY(point(r, "fromX", "fromY", &fx, &fy) && point(r, "toX", "toY", &tx, &ty));
	TRY(button_of(r, &button) && modifiers(r, &mods));
	double ms = fmax(ms_of(r, 0), 150);
	TRY(begin(&e));
	TRY(approach(fx, fy, e));
	Hold h;
	TRY(hold(mods, e, true, &h) && pause_ms(50, e));
	int id = press(true, button);
	TRY(id);
	TRY(pause_ms(120, e) && glide(tx, ty, ms, e) && pause_ms(120, e));
	release(id);
	unhold(&h);
	return true;
}

static double notches(double px) { return px == 0 ? 0 : copysign(fmax(1, round(fabs(px) / PIXELS_PER_NOTCH)), px); }

static bool wheel(unsigned button) {
	int id = press(true, button);
	TRY(id);
	release(id);
	return true;
}

static bool cmd_scroll(Json *r) {
	double x, y;
	unsigned mods;
	long e;
	TRY(point(r, "x", "y", &x, &y));
	double ny = notches(fmin(fmax(j_opt(r, "dy", 0), -1e6), 1e6));
	double nx = notches(fmin(fmax(j_opt(r, "dx", 0), -1e6), 1e6));
	double ms = ms_of(r, 400);
	if (ms <= 0) ms = 400;
	TRY(modifiers(r, &mods));
	TRY(begin(&e));
	TRY(approach(x, y, e));
	Hold h;
	TRY(hold(mods, e, true, &h));
	int steps = (int)fmax(1, round(ms / 16));
	double start = now();
	long sent_y = 0, sent_x = 0;
	for (int i = 1; i <= steps; i++) {
		TRY(check_abort(e));
		double p = ease((double)i / steps);
		long want_y = lround(ny * p), want_x = lround(nx * p);
		for (; sent_y != want_y; sent_y += want_y > sent_y ? 1 : -1) TRY(wheel(want_y > sent_y ? 5 : 4));
		for (; sent_x != want_x; sent_x += want_x > sent_x ? 1 : -1) TRY(wheel(want_x > sent_x ? 7 : 6));
		TRY(pause_until(start + ms / 1000 * i / steps, e));
	}
	unhold(&h);
	return true;
}

typedef struct { XkbDescPtr xkb; int group; unsigned locked, level3; char name[128]; } Layout;

static bool layout_open(Layout *l) {
	memset(l, 0, sizeof *l);
	if (!(l->xkb = XkbGetMap(in_dpy, XkbAllClientInfoMask, XkbUseCoreKbd))) return fail("keyboard layout unavailable");
	XkbStateRec st;
	if (XkbGetState(in_dpy, XkbUseCoreKbd, &st) == Success) {
		l->group = st.group;
		l->locked = st.locked_mods;
	}
	l->level3 = XkbKeysymToModifiers(in_dpy, XK_ISO_Level3_Shift);
	snprintf(l->name, sizeof l->name, "group %d", l->group + 1);
	if (XkbGetNames(in_dpy, XkbGroupNamesMask, l->xkb) == Success && l->xkb->names && l->xkb->names->groups[l->group]) {
		char *n = XGetAtomName(in_dpy, l->xkb->names->groups[l->group]);
		if (n) snprintf(l->name, sizeof l->name, "%s", n);
		XFree(n);
	}
	return true;
}

static void layout_close(Layout *l) {
	if (l->xkb) XkbFreeKeyboard(l->xkb, XkbAllComponentsMask, True);
}

static KeyCode spares[10];
static KeySym spare_syms[10];
static int spare_count = -1, spare_next;

static bool is_spare(int kc) {
	for (int i = 0; i < spare_count; i++)
		if (spares[i] == kc) return true;
	return false;
}

static bool layout_find(Layout *l, KeySym sym, bool any_group, KeyCode *code, unsigned *mods) {
	unsigned combos[4] = {0, ShiftMask, l->level3, ShiftMask | l->level3};
	int first = any_group ? 0 : l->group, last = any_group ? XkbNumKbdGroups - 1 : l->group;
	for (int g = first; g <= last; g++)
		for (int c = 0; c < (l->level3 ? 4 : 2); c++)
			for (int kc = l->xkb->min_key_code; kc <= l->xkb->max_key_code; kc++) {
				unsigned consumed;
				KeySym ks = NoSymbol;
				if (is_spare(kc) || !XkbTranslateKeyCode(l->xkb, (KeyCode)kc, XkbBuildCoreState(combos[c] | l->locked, g), &consumed, &ks) ||
					ks != sym)
					continue;
				*code = (KeyCode)kc;
				*mods = (combos[c] & ShiftMask ? M_SHIFT : 0) | (combos[c] & l->level3 ? M_LEVEL3 : 0);
				return true;
			}
	return false;
}

static KeySym keysym_for(unsigned cp) {
	return (cp >= 0x20 && cp < 0x7F) || (cp >= 0xA0 && cp <= 0xFF) ? cp : 0x01000000 | cp;
}

/* Characters the layout cannot produce go through spare keycodes temporarily mapped to their keysym, rotated so
 * a code is not remapped while an app may still be translating the previous press. Restored on exit. */

static bool remap(KeySym sym, KeyCode *code) {
	if (spare_count < 0) {
		int min, max, per;
		spare_count = 0;
		XDisplayKeycodes(in_dpy, &min, &max);
		KeySym *map = XGetKeyboardMapping(in_dpy, (KeyCode)min, max - min + 1, &per);
		for (int kc = max; map && kc >= min && spare_count < 10; kc--) {
			bool empty = true;
			for (int i = 0; i < per; i++) empty &= map[(kc - min) * per + i] == NoSymbol;
			if (empty) spares[spare_count++] = (KeyCode)kc;
		}
		if (map) XFree(map);
	}
	for (int i = 0; i < spare_count; i++)
		if (spare_syms[i] == sym) return *code = spares[i], true;
	if (!spare_count) return fail("no spare key is free to type U+%04lX on this keyboard", sym & 0xFFFFFF);
	int i = spare_next++ % spare_count;
	KeySym syms[2] = {sym, sym};
	XChangeKeyboardMapping(in_dpy, spares[i], 2, syms, 1);
	XSync(in_dpy, False);
	spare_syms[i] = sym;
	*code = spares[i];
	sleep_s(0.05);
	return true;
}

static void restore_spares(void) {
	KeySym none = NoSymbol;
	for (int i = 0; i < spare_count; i++)
		if (spare_syms[i]) XChangeKeyboardMapping(in_dpy, spares[i], 1, &none, 1);
	XSync(in_dpy, False);
}

static bool tap(KeyCode code, unsigned mods, long e) {
	Hold h;
	TRY(hold(mods, e, false, &h));
	int id = press(false, code);
	TRY(id);
	sleep_s(0.008);
	release(id);
	unhold(&h);
	return true;
}

static bool type_char(Layout *l, unsigned cp, long e) {
	KeySym sym = cp == '\n' || cp == '\r' ? XK_Return : cp == '\t' ? XK_Tab : keysym_for(cp);
	KeyCode code;
	unsigned mods = 0;
	if (!layout_find(l, sym, false, &code, &mods)) TRY(remap(sym, &code));
	return tap(code, mods, e);
}

static bool type_text(Json *r, Layout *l) {
	const char *text = j_str(r, "text");
	if (!text) return fail("missing text");
	double cps = j_opt(r, "cps", 15), interval = 1 / (cps > 0 ? cps : 15);
	long e;
	TRY(begin(&e) && layout_open(l));
	double start = now();
	for (int index = 0; *text; index++) {
		unsigned cp = utf8_next(&text);
		if (cp == '\r' && *text == '\n') text++;
		TRY(pause_until(start + index * interval, e) && type_char(l, cp, e));
	}
	return true;
}

static bool cmd_type(Json *r) {
	Layout l = {0};
	bool ok = type_text(r, &l);
	layout_close(&l);
	return ok;
}

static const struct { const char *name; KeySym sym; } named_keys[] = {
	{"enter", XK_Return}, {"tab", XK_Tab}, {"space", XK_space}, {"backspace", XK_BackSpace}, {"escape", XK_Escape},
	{"delete", XK_Delete}, {"home", XK_Home}, {"end", XK_End}, {"pageup", XK_Page_Up}, {"pagedown", XK_Page_Down},
	{"left", XK_Left}, {"right", XK_Right}, {"down", XK_Down}, {"up", XK_Up}, {"keypad0", XK_KP_0}, {"keypad1", XK_KP_1},
	{"keypad2", XK_KP_2}, {"keypad3", XK_KP_3}, {"keypad4", XK_KP_4}, {"keypad5", XK_KP_5}, {"keypad6", XK_KP_6},
	{"keypad7", XK_KP_7}, {"keypad8", XK_KP_8}, {"keypad9", XK_KP_9}, {"keypaddecimal", XK_KP_Decimal},
	{"keypadmultiply", XK_KP_Multiply}, {"keypadplus", XK_KP_Add}, {"keypadclear", XK_Clear},
	{"keypaddivide", XK_KP_Divide}, {"keypadenter", XK_KP_Enter}, {"keypadminus", XK_KP_Subtract},
	{"keypadequals", XK_KP_Equal},
};

static const char *const punctuation[][2] = {
	{"minus", "-"}, {"equal", "="}, {"leftbracket", "["}, {"rightbracket", "]"}, {"backslash", "\\"},
	{"semicolon", ";"}, {"quote", "'"}, {"comma", ","}, {"period", "."}, {"slash", "/"}, {"grave", "`"},
};

static KeySym named_keysym(const char *name) {
	for (size_t i = 0; i < sizeof named_keys / sizeof *named_keys; i++)
		if (!strcmp(name, named_keys[i].name)) return named_keys[i].sym;
	int n = 0, used = 0;
	if (sscanf(name, "f%d%n", &n, &used) == 1 && !name[used] && n >= 1 && n <= 20 && name[1] != '0') return XK_F1 + n - 1;
	return NoSymbol;
}

static bool press_key(Json *r, Layout *l) {
	const char *name = j_str(r, "key");
	unsigned mods, extra = 0, cp = 0;
	int count;
	long e;
	KeyCode code = 0;
	if (!name || !*name) return fail("missing key");
	TRY(modifiers(r, &mods) && integer(r, "repeat", 1, 1, 100, &count) && layout_open(l));
	KeySym sym = named_keysym(name);
	if (sym) {
		if (!layout_find(l, sym, false, &code, &extra)) TRY(remap(sym, &code));
	} else {
		const char *character = name;
		for (size_t i = 0; i < sizeof punctuation / sizeof *punctuation; i++)
			if (!strcmp(name, punctuation[i][0])) character = punctuation[i][1];
		const char *rest = character;
		cp = utf8_next(&rest);
		if (*rest)
			return fail("unknown key: %s. Use a key name such as enter, tab, escape, backspace, delete, up, pagedown or f5, "
						"or one character such as a, ? or é. To enter text, use type_text", name);
		if (layout_find(l, keysym_for(cp), false, &code, &extra) || (mods && layout_find(l, keysym_for(cp), true, &code, &extra)))
			cp = 0;
		else if (mods)
			return fail("%s is not a single key on the current keyboard layout (%s), so it cannot be pressed with "
						"modifiers. Press it without modifiers, or use type_text", character, l->name);
	}
	TRY(begin(&e));
	Hold h;
	TRY(hold(mods | extra, e, true, &h));
	double start = now();
	for (int i = 0; i < count; i++) {
		TRY(pause_until(start + i * 0.035, e));
		TRY(cp ? type_char(l, cp, e) : tap(code, 0, e));
	}
	unhold(&h);
	return true;
}

static bool cmd_key(Json *r) {
	Layout l = {0};
	bool ok = press_key(r, &l);
	layout_close(&l);
	return ok;
}

typedef struct { bool xtest, absolute, has_last; double min[2], max[2], last[2]; unsigned char scroll[8]; } Device;
static Device devices[256];
static KeyCode escape_code;
static XModifierKeymap *modmap;

static void load_devices(Display *d) {
	int n = 0;
	XIDeviceInfo *info = XIQueryDevice(d, XIAllDevices, &n);
	memset(devices, 0, sizeof devices);
	for (int i = 0; info && i < n; i++) {
		if (info[i].deviceid < 0 || info[i].deviceid >= 256) continue;
		Device *dev = &devices[info[i].deviceid];
		dev->xtest = strstr(info[i].name, "XTEST") != NULL;
		for (int c = 0; c < info[i].num_classes; c++) {
			XIAnyClassInfo *any = info[i].classes[c];
			if (any->type == XIValuatorClass) {
				XIValuatorClassInfo *v = (XIValuatorClassInfo *)any;
				if (v->number >= 2) continue;
				dev->min[v->number] = v->min;
				dev->max[v->number] = v->max;
				dev->absolute |= v->mode == XIModeAbsolute;
			} else if (any->type == XIScrollClass) {
				XIScrollClassInfo *s = (XIScrollClassInfo *)any;
				if (s->number < 64) dev->scroll[s->number / 8] |= (unsigned char)(1 << (s->number % 8));
			}
		}
	}
	if (info) XIFreeDeviceInfo(info);
}

static void load_keys(Display *d) {
	escape_code = XKeysymToKeycode(d, XK_Escape);
	if (modmap) XFreeModifiermap(modmap);
	modmap = XGetModifierMapping(d);
}

static bool is_modifier(int code) {
	for (int i = 0; modmap && i < 8 * modmap->max_keypermod; i++)
		if (modmap->modifiermap[i] == code) return true;
	return false;
}

static Device *device_of(XIRawEvent *ev) { return ev->sourceid >= 0 && ev->sourceid < 256 ? &devices[ev->sourceid] : NULL; }

static void on_motion(XIRawEvent *ev) {
	if (ev->flags & XIPointerEmulated) return;
	Device *dev = device_of(ev);
	double v[2] = {0, 0};
	bool has[2] = {false, false}, scrolled = false;
	const double *raw = ev->raw_values;
	for (int i = 0; i < ev->valuators.mask_len * 8; i++) {
		if (!XIMaskIsSet(ev->valuators.mask, i)) continue;
		double value = *raw++;
		if (dev && i < 64 && dev->scroll[i / 8] & (1 << (i % 8))) scrolled |= value != 0;
		else if (i < 2) v[i] = value, has[i] = true;
	}
	if (scrolled) user_input("scroll", false);
	if (!has[0] && !has[1]) return;
	pthread_mutex_lock(&st_lock);
	double px[2] = {has[0] ? v[0] : ptr_x, has[1] ? v[1] : ptr_y}, distance;
	if (dev && dev->xtest) {
		/* Raw XTest values are screen pixels for absolute motion (all of ours) but deltas for relative motion, and
		 * the event does not say which: take the reading that moved less. */
		double absolute = hypot(px[0] - ptr_x, px[1] - ptr_y), relative = hypot(v[0], v[1]);
		distance = has[0] && has[1] && expected(E_MOTION, 0, v[0], v[1]) ? 0 : fmin(absolute, relative);
		if (relative < absolute) px[0] = ptr_x + v[0], px[1] = ptr_y + v[1];
	} else if (dev && dev->absolute) {
		double size[2] = {DisplayWidth(mon_dpy, DefaultScreen(mon_dpy)), DisplayHeight(mon_dpy, DefaultScreen(mon_dpy))};
		for (int k = 0; k < 2; k++) {
			double range = dev->max[k] - dev->min[k];
			if (has[k] && range > 0) px[k] = (v[k] - dev->min[k]) / range * size[k];
			if (!has[k]) px[k] = dev->last[k];
		}
		distance = dev->has_last ? hypot(px[0] - dev->last[0], px[1] - dev->last[1]) : 0;
		dev->last[0] = px[0];
		dev->last[1] = px[1];
		dev->has_last = true;
	} else {
		distance = hypot(v[0], v[1]);
		px[0] = ptr_x + v[0];
		px[1] = ptr_y + v[1];
	}
	ptr_x = px[0];
	ptr_y = px[1];
	if (distance > 0) pointer_moved_locked(distance);
	pthread_mutex_unlock(&st_lock);
}

static void on_button(XIRawEvent *ev, bool down) {
	if (ev->flags & XIPointerEmulated) return;
	Device *dev = device_of(ev);
	if (dev && dev->xtest && expected(down ? E_BUTTON_DOWN : E_BUTTON_UP, ev->detail, 0, 0)) return;
	user_input(ev->detail >= 4 && ev->detail <= 7 ? "scroll" : "button", false);
}

static void on_key(XIRawEvent *ev, bool down) {
	Device *dev = device_of(ev);
	if (dev && dev->xtest && expected(down ? E_KEY_DOWN : E_KEY_UP, ev->detail, 0, 0)) return;
	if (down) user_input("key", ev->detail == escape_code);
	else if (is_modifier(ev->detail)) user_input("key", false);
}

static void *monitor_main(void *arg) {
	(void)arg;
	load_devices(mon_dpy);
	load_keys(mon_dpy);
	for (;;) {
		XEvent ev;
		XNextEvent(mon_dpy, &ev);
		if (ev.type == MappingNotify) {
			XRefreshKeyboardMapping(&ev.xmapping);
			load_keys(mon_dpy);
			continue;
		}
		XGenericEventCookie *c = &ev.xcookie;
		if (c->type != GenericEvent || c->extension != xi_opcode || !XGetEventData(mon_dpy, c)) continue;
		switch (c->evtype) {
		case XI_RawMotion: on_motion(c->data); break;
		case XI_RawButtonPress:
		case XI_RawButtonRelease: on_button(c->data, c->evtype == XI_RawButtonPress); break;
		case XI_RawKeyPress:
		case XI_RawKeyRelease: on_key(c->data, c->evtype == XI_RawKeyPress); break;
		case XI_RawTouchBegin: user_input("button", false); break;
		case XI_HierarchyChanged: load_devices(mon_dpy); break;
		}
		XFreeEventData(mon_dpy, c);
	}
	return NULL;
}

static bool arm(void) {
	if (!have_xi2) return fail("XInput2 is unavailable on this X server, so Recordly cannot notice when you take over");
	if (!mon_dpy) {
		Display *d = XOpenDisplay(NULL);
		int major = 2, minor = 2;
		if (!d || XIQueryVersion(d, &major, &minor) != Success) {
			if (d) XCloseDisplay(d);
			return fail("could not open the X display to watch for your input");
		}
		unsigned char raw[XIMaskLen(XI_LASTEVENT)] = {0}, hierarchy[XIMaskLen(XI_LASTEVENT)] = {0};
		int types[] = {XI_RawMotion, XI_RawButtonPress, XI_RawButtonRelease, XI_RawKeyPress, XI_RawKeyRelease};
		for (size_t i = 0; i < sizeof types / sizeof *types; i++) XISetMask(raw, types[i]);
		if (xi_minor >= 2) XISetMask(raw, XI_RawTouchBegin);
		XISetMask(hierarchy, XI_HierarchyChanged);
		XIEventMask masks[2] = {{XIAllMasterDevices, sizeof raw, raw}, {XIAllDevices, sizeof hierarchy, hierarchy}};
		x_error = 0;
		XISelectEvents(d, DefaultRootWindow(d), masks, 2);
		XSync(d, False);
		if (x_error) {
			XCloseDisplay(d);
			return fail("the X server refused to report raw input, so Recordly cannot notice when you take over");
		}
		mon_dpy = d;
		pthread_t thread;
		pthread_create(&thread, NULL, monitor_main, NULL);
		pthread_detach(thread);
	}
	double x, y;
	cursor(sync_dpy, &x, &y);
	set_armed(true, x, y);
	return true;
}

static Atom atom(Display *d, const char *name) { return XInternAtom(d, name, False); }

static unsigned char *prop(Display *d, Window w, const char *name, Atom type, unsigned long *count) {
	Atom actual;
	int format;
	unsigned long n = 0, after;
	unsigned char *data = NULL;
	x_error = 0;
	if (XGetWindowProperty(d, w, atom(d, name), 0, 1 << 16, False, type, &actual, &format, &n, &after, &data) != Success ||
		x_error || !n) {
		if (data) XFree(data);
		data = NULL;
		n = 0;
	}
	if (count) *count = n;
	return data;
}

static long card(Display *d, Window w, const char *name) {
	unsigned long n;
	long *p = (long *)prop(d, w, name, XA_CARDINAL, &n);
	long v = p ? p[0] : 0;
	if (p) XFree(p);
	return v;
}

static bool ewmh(Display *d, const char *feature) {
	unsigned long n;
	Atom *list = (Atom *)prop(d, DefaultRootWindow(d), "_NET_SUPPORTED", XA_ATOM, &n), want = atom(d, feature);
	bool found = false;
	for (unsigned long i = 0; i < n; i++) found |= list[i] == want;
	if (list) XFree(list);
	return found;
}

static Window client_of(Display *d, Window w, int depth) {
	unsigned char *state = prop(d, w, "WM_STATE", AnyPropertyType, NULL);
	if (state) return XFree(state), w;
	Window root, parent, *kids = NULL, found = 0;
	unsigned count = 0;
	x_error = 0;
	if (depth > 0 && XQueryTree(d, w, &root, &parent, &kids, &count) && !x_error)
		for (unsigned i = count; i-- > 0 && !found;) found = client_of(d, kids[i], depth - 1);
	if (kids) XFree(kids);
	return found;
}

static Window active_window(Display *d) {
	Window root = DefaultRootWindow(d), focus;
	if (ewmh(d, "_NET_ACTIVE_WINDOW")) {
		Window *p = (Window *)prop(d, root, "_NET_ACTIVE_WINDOW", XA_WINDOW, NULL), w = p ? p[0] : 0;
		if (p) XFree(p);
		return w;
	}
	int revert;
	XGetInputFocus(d, &focus, &revert);
	if (focus == None || focus == PointerRoot || focus == root) return 0;
	for (;;) {
		Window r, parent, *kids = NULL;
		unsigned n;
		x_error = 0;
		if (!XQueryTree(d, focus, &r, &parent, &kids, &n) || x_error) return 0;
		if (kids) XFree(kids);
		if (parent == root || parent == None) break;
		focus = parent;
	}
	Window client = client_of(d, focus, 3);
	return client ? client : focus;
}

static bool window_rect(Display *d, Window w, double r[4]) {
	XWindowAttributes a;
	int x = 0, y = 0;
	Window child;
	x_error = 0;
	if (!XGetWindowAttributes(d, w, &a) || x_error) return false;
	XTranslateCoordinates(d, w, DefaultRootWindow(d), 0, 0, &x, &y, &child);
	r[0] = x;
	r[1] = y;
	r[2] = a.width;
	r[3] = a.height;
	return true;
}

static void outer_rect(Display *d, Window w, const double r[4], double out[4]) {
	unsigned long n;
	long *e = (long *)prop(d, w, "_NET_FRAME_EXTENTS", XA_CARDINAL, &n), ext[4] = {0, 0, 0, 0};
	for (unsigned long i = 0; e && i < 4 && i < n; i++) ext[i] = e[i];
	if (e) XFree(e);
	out[0] = r[0] - ext[0];
	out[1] = r[1] - ext[2];
	out[2] = r[2] + ext[0] + ext[1];
	out[3] = r[3] + ext[2] + ext[3];
}

static char *window_title(Display *d, Window w) {
	unsigned long n;
	unsigned char *p = prop(d, w, "_NET_WM_NAME", atom(d, "UTF8_STRING"), &n);
	if (!p) p = prop(d, w, "WM_NAME", AnyPropertyType, &n);
	char *s = strndup(p ? (char *)p : "", n);
	if (p) XFree(p);
	return s;
}

static char *app_name(Display *d, Window w, long pid) {
	unsigned long n;
	char *p = (char *)prop(d, w, "WM_CLASS", XA_STRING, &n), name[256] = "";
	size_t first = p ? strnlen(p, n) : n;
	if (p && first + 1 < n) snprintf(name, sizeof name, "%.*s", (int)strnlen(p + first + 1, n - first - 1), p + first + 1);
	if (p) XFree(p);
	if (!name[0] && pid > 0) {
		char path[64];
		snprintf(path, sizeof path, "/proc/%ld/comm", pid);
		FILE *f = fopen(path, "r");
		if (f && fgets(name, sizeof name, f)) name[strcspn(name, "\n")] = 0;
		if (f) fclose(f);
	}
	return strdup(name);
}

static bool cmd_frontmost(Json *r, Buf *out) {
	(void)r;
	Display *d = XOpenDisplay(NULL);
	if (!d) return fail(WAYLAND_MESSAGE);
	Window w = active_window(d);
	double rect[4];
	if (!w || !window_rect(d, w, rect)) {
		b_puts(out, ",\"window\":null");
		XCloseDisplay(d);
		return true;
	}
	long pid = card(d, w, "_NET_WM_PID");
	char *title = window_title(d, w), *app = app_name(d, w, pid);
	b_printf(out, ",\"window\":{\"pid\":%ld,\"windowId\":%lu,\"title\":", pid, (unsigned long)w);
	b_str(out, title);
	b_puts(out, ",\"appName\":");
	b_str(out, app);
	b_puts(out, ",\"bundleId\":null");
	const char *keys[4] = {"x", "y", "width", "height"};
	for (int i = 0; i < 4; i++) {
		b_printf(out, ",\"%s\":", keys[i]);
		b_num(out, rect[i]);
	}
	b_puts(out, "}");
	free(title);
	free(app);
	XCloseDisplay(d);
	return true;
}

static bool cmd_window_info(Json *r, Buf *out) {
	Window w = window_id(r);
	if (!w) return fail("missing or invalid windowId");
	Display *d = XOpenDisplay(NULL);
	if (!d) return fail(WAYLAND_MESSAGE);
	XWindowAttributes a;
	double rect[4];
	x_error = 0;
	if (!XGetWindowAttributes(d, w, &a) || x_error || !window_rect(d, w, rect)) {
		b_puts(out, ",\"window\":null");
		XCloseDisplay(d);
		return true;
	}
	unsigned long n;
	Atom *states = (Atom *)prop(d, w, "_NET_WM_STATE", XA_ATOM, &n), hidden = atom(d, "_NET_WM_STATE_HIDDEN");
	bool minimized = false;
	for (unsigned long i = 0; i < n; i++) minimized |= states[i] == hidden;
	if (states) XFree(states);
	long *wm = (long *)prop(d, w, "WM_STATE", AnyPropertyType, &n);
	if (wm) minimized |= wm[0] == IconicState;
	if (wm) XFree(wm);
	long pid = card(d, w, "_NET_WM_PID");
	char *title = window_title(d, w), *app = app_name(d, w, pid);
	b_printf(out, ",\"window\":{\"pid\":%ld,\"windowId\":%lu,\"title\":", pid, (unsigned long)w);
	b_str(out, title);
	b_puts(out, ",\"appName\":");
	b_str(out, app);
	b_printf(out, ",\"frame\":{\"x\":%.15g,\"y\":%.15g,\"width\":%.15g,\"height\":%.15g}", rect[0], rect[1], rect[2], rect[3]);
	b_printf(out, ",\"visible\":%s,\"minimized\":%s}", a.map_state == IsViewable && !minimized ? "true" : "false",
		minimized ? "true" : "false");
	free(title);
	free(app);
	XCloseDisplay(d);
	return true;
}

static Window match_window(Display *d, int pid, Window id, const double frame[4]) {
	double r[4], o[4];
	if (id) {
		long owner = window_rect(d, id, r) ? card(d, id, "_NET_WM_PID") : -1;
		return owner == 0 || owner == pid ? id : 0;
	}
	unsigned long n;
	Window *list = (Window *)prop(d, DefaultRootWindow(d), "_NET_CLIENT_LIST_STACKING", XA_WINDOW, &n), found = 0;
	for (unsigned long i = n; i-- > 0 && !found;) {
		if (card(d, list[i], "_NET_WM_PID") != pid || !window_rect(d, list[i], r)) continue;
		outer_rect(d, list[i], r, o);
		if (near(r, frame, 4) || near(o, frame, 4)) found = list[i];
	}
	if (list) XFree(list);
	return found;
}

static bool cmd_raise(Json *r, Buf *out) {
	int pid = 0;
	double frame[4];
	TRY(need_pid(r, &pid) && need_frame(r, frame));
	if (kill(pid, 0) != 0 && errno == ESRCH) return fail("process %d is not running", pid);
	Display *d = XOpenDisplay(NULL);
	if (!d) return fail(WAYLAND_MESSAGE);
	Window w;
	for (double deadline = now() + 1; !(w = match_window(d, pid, window_id(r), frame)) && now() < deadline;) sleep_s(0.1);
	bool raised = false;
	if (w) {
		if (ewmh(d, "_NET_ACTIVE_WINDOW")) {
			XEvent e = {0};
			e.xclient.type = ClientMessage;
			e.xclient.window = w;
			e.xclient.message_type = atom(d, "_NET_ACTIVE_WINDOW");
			e.xclient.format = 32;
			e.xclient.data.l[0] = 2;
			e.xclient.data.l[1] = CurrentTime;
			XSendEvent(d, DefaultRootWindow(d), False, SubstructureRedirectMask | SubstructureNotifyMask, &e);
		} else {
			XMapRaised(d, w);
			XSetInputFocus(d, w, RevertToParent, CurrentTime);
		}
		XFlush(d);
		for (double deadline = now() + 1; !(raised = active_window(d) == w) && now() < deadline;) sleep_s(0.02);
	}
	b_printf(out, ",\"raised\":%s", raised ? "true" : "false");
	XCloseDisplay(d);
	return true;
}

// "bounds" use the same rectangle "frame" does: the client window, in X11 pixels. The window manager
// may still adjust the result (minimum sizes, struts), so the rectangle actually applied is reported back.
static bool cmd_set_bounds(Json *r, Buf *out) {
	int pid = 0;
	double frame[4], b[4] = {0, 0, 0, 0};
	TRY(need_pid(r, &pid) && need_frame(r, frame));
	Json *raw = j_get(r, "bounds");
	if (!raw || raw->t != J_OBJ) return fail("missing bounds");
	TRY(need_num(raw, "x", &b[0]) && need_num(raw, "y", &b[1]) && need_num(raw, "width", &b[2]) && need_num(raw, "height", &b[3]));
	if (b[2] < 1 || b[3] < 1) return fail("width and height must be at least 1");
	Display *d = XOpenDisplay(NULL);
	if (!d) return fail(WAYLAND_MESSAGE);
	Window w = match_window(d, pid, window_id(r), frame);
	if (!w) {
		XCloseDisplay(d);
		return fail("the window could not be found");
	}
	XMoveResizeWindow(d, w, (int)lround(b[0]), (int)lround(b[1]), (unsigned)lround(b[2]), (unsigned)lround(b[3]));
	XSync(d, False);
	sleep_s(0.15);
	double actual[4];
	if (window_rect(d, w, actual))
		b_printf(out, ",\"frame\":{\"x\":%.15g,\"y\":%.15g,\"width\":%.15g,\"height\":%.15g}", actual[0], actual[1], actual[2], actual[3]);
	XCloseDisplay(d);
	return true;
}

typedef struct { int x, y, width, height; } AtspiRect;
enum {
	R_CHECK_BOX = 7, R_CHECK_MENU_ITEM = 8, R_COMBO_BOX = 11, R_ICON = 26, R_IMAGE = 27, R_LABEL = 29, R_MENU = 33,
	R_MENU_ITEM = 35, R_PAGE_TAB = 37, R_PASSWORD_TEXT = 40, R_PUSH_BUTTON = 43, R_RADIO_BUTTON = 44,
	R_RADIO_MENU_ITEM = 45, R_TEXT = 61, R_TOGGLE_BUTTON = 62, R_PARAGRAPH = 73, R_ENTRY = 79, R_HEADING = 83,
	R_LINK = 88, R_STATIC = 116, R_PUSH_BUTTON_MENU = 129, R_LAST = 130, R_SCROLL_PANE = 49, R_VIEWPORT = 68,
	R_DOCUMENT_FRAME = 82, R_DOCUMENT_WEB = 95,
};
enum { S_EDITABLE = 7, S_MULTI_LINE = 17, S_SHOWING = 25, S_VISIBLE = 30 };

/* libatspi is loaded at runtime so input keeps working where at-spi2-core is missing. Not thread safe: all
 * calls happen under at.lock. */
static struct {
	pthread_mutex_t lock;
	bool tried;
	atomic_bool ready;
	char why[200];
	int (*init)(void);
	void (*set_timeout)(int, int);
	void *(*desktop)(int);
	int (*child_count)(void *, void **);
	void *(*child)(void *, int, void **);
	unsigned (*pid)(void *, void **);
	int (*role)(void *, void **);
	char *(*role_name)(int);
	char *(*name)(void *, void **);
	char *(*description)(void *, void **);
	char *(*help)(void *, void **);
	void *(*states)(void *);
	int (*has_state)(void *, int);
	void *(*component)(void *);
	AtspiRect *(*extents)(void *, int, void **);
	void *(*at_point)(void *, int, int, int, void **);
	void *(*parent)(void *, void **);
	void *(*text)(void *);
	int (*char_count)(void *, void **);
	char *(*get_text)(void *, int, int, void **);
	void *(*attributes)(void *, void **);
	void (*free)(void *);
	void (*unref)(void *);
	void (*error_free)(void *);
	void *(*lookup)(void *, const void *);
	void (*hash_unref)(void *);
	char *(*down)(const char *, long);
} at = {.lock = PTHREAD_MUTEX_INITIALIZER};

static bool atspi_ready(void) {
	if (at.tried) return at.ready;
	at.tried = true;
	void *h = dlopen("libatspi.so.0", RTLD_NOW | RTLD_LOCAL);
	if (!h) return snprintf(at.why, sizeof at.why, "libatspi (at-spi2-core) is not installed"), false;
	struct { const char *name; void **slot; bool optional; } syms[] = {
		{"atspi_init", (void **)&at.init, false},
		{"atspi_set_timeout", (void **)&at.set_timeout, true},
		{"atspi_get_desktop", (void **)&at.desktop, false},
		{"atspi_accessible_get_child_count", (void **)&at.child_count, false},
		{"atspi_accessible_get_child_at_index", (void **)&at.child, false},
		{"atspi_accessible_get_process_id", (void **)&at.pid, false},
		{"atspi_accessible_get_role", (void **)&at.role, false},
		{"atspi_role_get_name", (void **)&at.role_name, false},
		{"atspi_accessible_get_name", (void **)&at.name, false},
		{"atspi_accessible_get_description", (void **)&at.description, false},
		{"atspi_accessible_get_help_text", (void **)&at.help, true},
		{"atspi_accessible_get_state_set", (void **)&at.states, false},
		{"atspi_state_set_contains", (void **)&at.has_state, false},
		{"atspi_accessible_get_component_iface", (void **)&at.component, false},
		{"atspi_component_get_extents", (void **)&at.extents, false},
		{"atspi_component_get_accessible_at_point", (void **)&at.at_point, false},
		{"atspi_accessible_get_parent", (void **)&at.parent, false},
		{"atspi_accessible_get_text_iface", (void **)&at.text, false},
		{"atspi_text_get_character_count", (void **)&at.char_count, false},
		{"atspi_text_get_text", (void **)&at.get_text, false},
		{"atspi_accessible_get_attributes", (void **)&at.attributes, false},
		{"g_free", (void **)&at.free, false},
		{"g_object_unref", (void **)&at.unref, false},
		{"g_error_free", (void **)&at.error_free, false},
		{"g_hash_table_lookup", (void **)&at.lookup, false},
		{"g_hash_table_unref", (void **)&at.hash_unref, false},
		{"g_utf8_strdown", (void **)&at.down, false},
	};
	for (size_t i = 0; i < sizeof syms / sizeof *syms; i++)
		if (!(*syms[i].slot = dlsym(h, syms[i].name)) && !syms[i].optional)
			return snprintf(at.why, sizeof at.why, "libatspi is missing %s", syms[i].name), false;
	if (at.init() > 1) return snprintf(at.why, sizeof at.why, "the accessibility bus (at-spi-bus-launcher) is not running"), false;
	if (at.set_timeout) at.set_timeout(500, 2000);
	return at.ready = true;
}

static void clear(void **err) {
	if (*err) at.error_free(*err);
	*err = NULL;
}

static bool state(void *states, int s) { return !states || at.has_state(states, s); }

static bool extents(void *obj, double box[4]) {
	void *c = at.component(obj), *err = NULL;
	if (!c) return false;
	AtspiRect *r = at.extents(c, 0, &err);
	clear(&err);
	at.unref(c);
	if (!r) return false;
	box[0] = r->x;
	box[1] = r->y;
	box[2] = r->width;
	box[3] = r->height;
	at.free(r);
	return true;
}

static void *app_for(int pid) {
	void *desk = at.desktop(0), *err = NULL, *found = NULL;
	int n = desk ? at.child_count(desk, &err) : 0;
	clear(&err);
	for (int i = 0; i < n && !found; i++) {
		void *app = at.child(desk, i, &err);
		clear(&err);
		if (!app) continue;
		unsigned p = at.pid(app, &err);
		clear(&err);
		if ((int)p == pid) found = app;
		else at.unref(app);
	}
	if (desk) at.unref(desk);
	return found;
}

/* mode 0: extents match the window (client or decorated frame); 1: same title; 2: the only showing window. */
static void *pick_window(void *app, int mode, const double frame[4], const double outer[4], const char *title) {
	void *err = NULL, *pick = NULL;
	int showing = 0, n = at.child_count(app, &err);
	clear(&err);
	for (int i = 0; i < n; i++) {
		void *w = at.child(app, i, &err);
		clear(&err);
		if (!w) continue;
		bool ok;
		double box[4];
		if (mode == 0) ok = extents(w, box) && (near(box, frame, 8) || near(box, outer, 8));
		else if (mode == 1) {
			char *name = at.name(w, &err);
			clear(&err);
			ok = title[0] && name && !strcmp(name, title);
			at.free(name);
		} else {
			void *st = at.states(w);
			ok = st && at.has_state(st, S_SHOWING);
			if (st) at.unref(st);
			showing += ok;
		}
		if (ok && !pick) {
			pick = w;
			if (mode < 2) break;
		} else at.unref(w);
	}
	if (mode == 2 && showing != 1 && pick) at.unref(pick), pick = NULL;
	return pick;
}

static const char *ax_role(int role, void *states) {
	switch (role) {
	case R_PUSH_BUTTON:
	case R_TOGGLE_BUTTON: return "AXButton";
	case R_PUSH_BUTTON_MENU: return "AXMenuButton";
	case R_LINK: return "AXLink";
	case R_TEXT:
	case R_ENTRY:
	case R_PASSWORD_TEXT:
		if (role == R_TEXT && !state(states, S_EDITABLE)) return "AXStaticText";
		return states && at.has_state(states, S_MULTI_LINE) ? "AXTextArea" : "AXTextField";
	case R_COMBO_BOX: return states && at.has_state(states, S_EDITABLE) ? "AXComboBox" : "AXPopUpButton";
	case R_CHECK_BOX: return "AXCheckBox";
	case R_RADIO_BUTTON: return "AXRadioButton";
	case R_PAGE_TAB: return "AXTabButton";
	case R_MENU:
	case R_MENU_ITEM:
	case R_CHECK_MENU_ITEM:
	case R_RADIO_MENU_ITEM: return "AXMenuItem";
	case R_LABEL:
	case R_STATIC:
	case R_PARAGRAPH: return "AXStaticText";
	case R_HEADING: return "AXHeading";
	case R_IMAGE:
	case R_ICON: return "AXImage";
	}
	return NULL;
}

static const char *const actionable[] = {"AXButton", "AXMenuButton", "AXLink", "AXTextField", "AXTextArea", "AXComboBox",
	"AXCheckBox", "AXRadioButton", "AXTabButton", "AXMenuItem", "AXPopUpButton", NULL};
static const struct { const char *alias; const char *roles[4]; } role_aliases[] = {
	{"button", {"AXButton", "AXMenuButton"}}, {"link", {"AXLink"}},
	{"textbox", {"AXTextField", "AXTextArea", "AXComboBox"}}, {"textfield", {"AXTextField", "AXTextArea", "AXComboBox"}},
	{"checkbox", {"AXCheckBox"}}, {"radio", {"AXRadioButton"}}, {"tab", {"AXTabButton"}},
	{"menuitem", {"AXMenuItem", "AXMenuBarItem"}}, {"text", {"AXStaticText"}}, {"statictext", {"AXStaticText"}},
	{"heading", {"AXHeading"}}, {"image", {"AXImage"}},
};

static char *trimmed(const char *s) {
	if (!s) return strdup("");
	while (*s == ' ' || (*s >= '\t' && *s <= '\r')) s++;
	size_t n = strlen(s);
	while (n && (s[n - 1] == ' ' || (s[n - 1] >= '\t' && s[n - 1] <= '\r'))) n--;
	return strndup(s, n);
}

static char *label_at(void *obj, int k) {
	void *err = NULL, *iface;
	char *s = NULL, *copy;
	if (k == 0) s = at.name(obj, &err);
	else if (k == 1) s = at.description(obj, &err);
	else if (k == 2 && (iface = at.text(obj))) {
		int n = at.char_count(iface, &err);
		clear(&err);
		if (n > 0) s = at.get_text(iface, 0, n < 2000 ? n : 2000, &err);
		at.unref(iface);
	} else if (k == 3 && at.help) s = at.help(obj, &err);
	else if (k == 4 && (iface = at.attributes(obj, &err))) {
		const char *v = at.lookup(iface, "placeholder-text");
		copy = trimmed(v);
		at.hash_unref(iface);
		return copy;
	}
	clear(&err);
	copy = trimmed(s);
	at.free(s);
	return copy;
}

static bool contains_folded(const char *haystack, const char *needle) {
	char *folded = at.down(haystack, -1);
	bool found = folded && strstr(folded, needle);
	at.free(folded);
	return found;
}

typedef struct { void *obj; int depth; int *path; bool web, scoped; double scope[4]; } Node;
typedef struct { int *path; int depth; char *json; } Match;

static int by_path(const void *a, const void *b) {
	const Match *x = a, *y = b;
	for (int i = 0; i < x->depth && i < y->depth; i++)
		if (x->path[i] != y->path[i]) return x->path[i] < y->path[i] ? -1 : 1;
	return x->depth - y->depth;
}

static bool centred_in(const double r[4], double x, double y) {
	return x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
}

static char *element_json(const Node *node, int role, const char *const *roles, const char *text, const double bounds[4], bool offscreen) {
	void *obj = node->obj;
	void *states = at.states(obj);
	char *raw = at.role_name(role), *labels[5] = {0}, *json = NULL;
	const char *ax = ax_role(role, states), *label = NULL;
	if (!ax) ax = raw ? raw : "";
	bool ok = state(states, S_VISIBLE), matched = !*text;
	if (ok && roles) {
		ok = false;
		for (int i = 0; roles[i]; i++) ok |= !strcmp(roles[i], ax) || (raw && !strcmp(roles[i], raw));
	}
	for (int k = 0; ok && k < 5 && (!matched || !label); k++) {
		labels[k] = label_at(obj, k);
		if (!*labels[k]) continue;
		if (!label) label = labels[k];
		matched |= contains_folded(labels[k], text);
	}
	double b[4];
	if (ok && matched && extents(obj, b) && b[0] > -2147483648.0 && b[1] > -2147483648.0 &&
		!(b[0] <= bounds[0] && b[1] <= bounds[1] && b[0] + b[2] >= bounds[0] + bounds[2] && b[1] + b[3] >= bounds[1] + bounds[3])) {
		double cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
		bool visible = b[2] > 1 && b[3] > 1 && state(states, S_SHOWING) && centred_in(bounds, cx, cy) &&
			(!node->scoped || centred_in(node->scope, cx, cy));
		if (visible || (offscreen && fmax(b[2], b[3]) > 1)) {
			Buf j = {0};
			char cut[1024] = "";
			const char *p = label ? label : "";
			for (int i = 0; i < 200 && *p; i++) utf8_next(&p);
			snprintf(cut, sizeof cut, "%.*s", (int)(p - (label ? label : "")), label ? label : "");
			b_puts(&j, "{\"role\":");
			b_str(&j, ax);
			b_puts(&j, ",\"label\":");
			b_str(&j, cut);
			const char *keys[4] = {"x", "y", "width", "height"};
			for (int i = 0; i < 4; i++) {
				b_printf(&j, ",\"%s\":", keys[i]);
				b_num(&j, b[i]);
			}
			if (node->web) b_puts(&j, ",\"web\":true");
			if (!visible) b_puts(&j, ",\"visible\":false");
			if (!visible && node->scoped)
				b_printf(&j, ",\"container\":{\"x\":%.15g,\"y\":%.15g,\"width\":%.15g,\"height\":%.15g}", node->scope[0],
					node->scope[1], node->scope[2], node->scope[3]);
			b_puts(&j, "}");
			json = j.s;
		}
	}
	for (int k = 0; k < 5; k++) free(labels[k]);
	at.free(raw);
	if (states) at.unref(states);
	return json;
}

static bool walk(void *window, const char *const *roles, const char *text, const double bounds[4], bool offscreen, int limit, Buf *out) {
	double deadline = now() + FIND_SECONDS;
	int head = 0, len = 1, cap = 256, matched = 0, match_cap = 0;
	Node *queue = malloc(cap * sizeof *queue);
	Match *matches = NULL;
	bool exhausted = false;
	queue[0] = (Node){.obj = window};
	while (head < len) {
		if (head >= FIND_NODES || now() > deadline) {
			exhausted = true;
			break;
		}
		Node node = queue[head++];
		void *err = NULL;
		int role = at.role(node.obj, &err);
		clear(&err);
		int n = node.depth < 100 ? at.child_count(node.obj, &err) : 0;
		clear(&err);
		Node inherit = node;
		bool document = role == R_DOCUMENT_WEB || role == R_DOCUMENT_FRAME;
		double box[4];
		inherit.web |= document;
		if (n && (document || role == R_SCROLL_PANE || role == R_VIEWPORT) && extents(node.obj, box) &&
			box[0] > -2147483648.0 && box[1] > -2147483648.0 && box[2] > 1 && box[3] > 1) {
			inherit.scoped = true;
			memcpy(inherit.scope, box, sizeof box);
		}
		for (int i = 0; i < n; i++) {
			void *child = at.child(node.obj, i, &err);
			clear(&err);
			if (!child) continue;
			if (len == cap) queue = realloc(queue, (cap *= 2) * sizeof *queue);
			int *path = malloc((node.depth + 1) * sizeof *path);
			if (node.depth) memcpy(path, node.path, node.depth * sizeof *path);
			path[node.depth] = i;
			queue[len++] = (Node){child, node.depth + 1, path, inherit.web, inherit.scoped, {inherit.scope[0], inherit.scope[1], inherit.scope[2], inherit.scope[3]}};
		}
		char *json = element_json(&node, role, roles, text, bounds, offscreen);
		if (json) {
			if (matched == match_cap) matches = realloc(matches, (match_cap = match_cap * 2 + 16) * sizeof *matches);
			matches[matched++] = (Match){node.path, node.depth, json};
		} else free(node.path);
		at.unref(node.obj);
	}
	for (; head < len; head++) {
		at.unref(queue[head].obj);
		free(queue[head].path);
	}
	free(queue);
	qsort(matches, matched, sizeof *matches, by_path);
	b_puts(out, ",\"elements\":[");
	for (int i = 0; i < matched; i++) {
		if (i < limit) {
			if (i) b_puts(out, ",");
			b_puts(out, matches[i].json);
		}
		free(matches[i].json);
		free(matches[i].path);
	}
	free(matches);
	b_printf(out, "],\"truncated\":%s", exhausted || matched > limit ? "true" : "false");
	return true;
}

static char *point_element(void *obj) {
	void *err = NULL, *states = at.states(obj);
	int role = at.role(obj, &err);
	clear(&err);
	char *raw = at.role_name(role), *label = NULL;
	const char *ax = ax_role(role, states);
	if (!ax) ax = raw ? raw : "";
	for (int k = 0; k < 3 && !label; k++) {
		char *value = label_at(obj, k);
		if (*value) label = value;
		else free(value);
	}
	double b[4] = {0, 0, 0, 0};
	extents(obj, b);
	const char *text = label ? label : "", *cut = text;
	for (int i = 0; i < 200 && *cut; i++) utf8_next(&cut);
	Buf j = {0};
	b_puts(&j, "{\"role\":");
	b_str(&j, ax);
	b_puts(&j, ",\"label\":");
	char clipped[1024] = "";
	snprintf(clipped, sizeof clipped, "%.*s", (int)(cut - text), text);
	b_str(&j, clipped);
	const char *keys[4] = {"x", "y", "width", "height"};
	for (int i = 0; i < 4; i++) {
		b_printf(&j, ",\"%s\":", keys[i]);
		b_num(&j, b[i]);
	}
	b_puts(&j, "}");
	free(label);
	at.free(raw);
	if (states) at.unref(states);
	return j.s;
}

/* get_accessible_at_point only descends one level, so follow it down until it stops. */
static void *deepest_at(void *window, int x, int y) {
	void *current = window;
	for (int depth = 0; depth < 100; depth++) {
		void *component = at.component(current), *err = NULL, *child = NULL;
		if (component) {
			child = at.at_point(component, x, y, 0, &err);
			clear(&err);
			at.unref(component);
		}
		if (!child || child == current) {
			if (child) at.unref(child);
			return current;
		}
		at.unref(current);
		current = child;
	}
	return current;
}

static void nothing(Buf *out) { b_puts(out, ",\"hit\":null,\"parent\":null"); }

static bool cmd_at(Json *r, Buf *out) {
	int pid = 0;
	double x, y;
	TRY(need_pid(r, &pid) && point(r, "x", "y", &x, &y));
	pthread_mutex_lock(&at.lock);
	void *window = NULL, *app = atspi_ready() ? app_for(pid) : NULL;
	void *err = NULL;
	int n = app ? at.child_count(app, &err) : 0;
	clear(&err);
	for (int i = 0; i < n && !window; i++) {
		void *candidate = at.child(app, i, &err);
		clear(&err);
		double box[4];
		if (candidate && extents(candidate, box) && box[2] > 0 && box[3] > 0 && centred_in(box, x, y)) window = candidate;
		else if (candidate) at.unref(candidate);
	}
	if (app) at.unref(app);
	if (!window) nothing(out);
	else {
		void *hit = deepest_at(window, (int)lround(x), (int)lround(y));
		char *element = point_element(hit);
		b_puts(out, ",\"hit\":");
		b_puts(out, element);
		free(element);
		void *parent = at.parent(hit, &err);
		clear(&err);
		b_puts(out, ",\"parent\":");
		if (!parent) b_puts(out, "null");
		else {
			char *above = point_element(parent);
			b_puts(out, above);
			free(above);
			at.unref(parent);
		}
		at.unref(hit);
	}
	pthread_mutex_unlock(&at.lock);
	return true;
}

static bool find_locked(int pid, const double bounds[4], const double outer[4], const char *title,
	const char *role_query, const char *const *roles, const char *query, bool offscreen, int limit, Buf *out) {
	if (!atspi_ready()) return fail("find needs the AT-SPI accessibility bus, but %s", at.why);
	char canonical[64] = "";
	const char *raw[2] = {canonical, NULL};
	if (*role_query && !roles) {
		for (int r = 0; r < R_LAST && !canonical[0]; r++) {
			char *name = at.role_name(r);
			if (name && !strcasecmp(name, role_query)) snprintf(canonical, sizeof canonical, "%s", name);
			at.free(name);
		}
		if (!canonical[0]) return fail("unknown role: %s", role_query);
		roles = raw;
	}
	char *text = at.down(query, -1);
	void *window = NULL;
	for (double deadline = now() + 1;; sleep_s(0.1)) {
		void *app = app_for(pid);
		for (int mode = 0; app && mode < 3 && !window; mode++) window = pick_window(app, mode, bounds, outer, title);
		if (app) at.unref(app);
		if (window || now() >= deadline) break;
	}
	bool ok = window ? walk(window, roles, text ? text : "", bounds, offscreen, limit, out) : fail("window not found in process %d", pid);
	at.free(text);
	return ok;
}

static bool cmd_find(Json *r, Buf *out) {
	int pid = 0;
	double bounds[4], outer[4];
	TRY(need_pid(r, &pid) && need_frame(r, bounds));
	double requested = j_opt(r, "limit", 50);
	int limit = requested >= 2 ? (int)fmin(requested, 1e6) : 1;
	Json *off = j_get(r, "offscreen");
	bool offscreen = off && off->t == J_TRUE;
	char *query = trimmed(j_str(r, "text")), *role_query = trimmed(j_str(r, "role")), *title = strdup("");
	const char *single[2] = {role_query, NULL};
	const char *const *roles = NULL;
	if (!*role_query) roles = *query ? NULL : actionable;
	else if (!strncmp(role_query, "AX", 2)) roles = single;
	else {
		for (size_t i = 0; i < sizeof role_aliases / sizeof *role_aliases; i++)
			if (!strcasecmp(role_query, role_aliases[i].alias)) roles = role_aliases[i].roles;
	}
	memcpy(outer, bounds, sizeof outer);
	Window xid = window_id(r);
	Display *d = xid ? XOpenDisplay(NULL) : NULL;
	double rect[4];
	if (d && window_rect(d, xid, rect)) {
		outer_rect(d, xid, rect, outer);
		free(title);
		title = window_title(d, xid);
	}
	if (d) XCloseDisplay(d);
	pthread_mutex_lock(&at.lock);
	bool ok = find_locked(pid, bounds, outer, title, role_query, roles, query, offscreen, limit, out);
	pthread_mutex_unlock(&at.lock);
	free(query);
	free(role_query);
	free(title);
	return ok;
}

static void release_and_exit(void) {
	static pthread_mutex_t once = PTHREAD_MUTEX_INITIALIZER;
	pthread_mutex_lock(&once);
	release_all(true);
	if (in_dpy) restore_spares();
	_exit(0);
}

typedef bool (*InputFn)(Json *);
typedef bool (*WorkFn)(Json *, Buf *);
typedef struct Job { struct Job *next; Json *req; char id[48]; InputFn input; WorkFn work; } Job;
static Job *jobs_head, *jobs_tail;
static pthread_mutex_t jobs_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t jobs_cond = PTHREAD_COND_INITIALIZER;

static void *input_main(void *arg) {
	(void)arg;
	for (;;) {
		pthread_mutex_lock(&jobs_lock);
		while (!jobs_head) pthread_cond_wait(&jobs_cond, &jobs_lock);
		Job *job = jobs_head;
		if (!(jobs_head = job->next)) jobs_tail = NULL;
		pthread_mutex_unlock(&jobs_lock);
		drain(in_dpy);
		bool ok = job->input(job->req);
		release_all(false);
		reply(job->id, ok, NULL);
		j_free(job->req);
		free(job);
	}
	return NULL;
}

static void *work_main(void *arg) {
	Job *job = arg;
	Buf body = {0};
	bool ok = job->work(job->req, &body);
	reply(job->id, ok, &body);
	j_free(job->req);
	free(job);
	return NULL;
}

static void *signal_main(void *arg) {
	int sig;
	sigwait(arg, &sig);
	release_and_exit();
}

static const struct { const char *name; InputFn input; WorkFn work; } commands[] = {
	{"move", cmd_move, NULL}, {"click", cmd_click, NULL}, {"drag", cmd_drag, NULL}, {"scroll", cmd_scroll, NULL},
	{"type", cmd_type, NULL}, {"key", cmd_key, NULL}, {"frontmost_window", NULL, cmd_frontmost},
	{"raise", NULL, cmd_raise}, {"set_bounds", NULL, cmd_set_bounds}, {"find", NULL, cmd_find}, {"window_info", NULL, cmd_window_info}, {"at", NULL, cmd_at}, {"preflight", NULL, NULL}, {"cursor", NULL, NULL},
	{"arm", NULL, NULL}, {"disarm", NULL, NULL},
};

static void handle(const char *line) {
	const char *p = line;
	Json *req = j_value(&p, 0);
	if (req) j_ws(&p);
	if (!req || *p || req->t != J_OBJ) {
		j_free(req);
		fail("invalid request");
		reply("null", false, NULL);
		return;
	}
	char id[48] = "null";
	double n;
	if (j_num(req, "id", &n)) snprintf(id, sizeof id, "%.15g", n);
	const char *cmd = j_str(req, "cmd") ? j_str(req, "cmd") : "";
	int found = -1;
	for (size_t i = 0; i < sizeof commands / sizeof *commands; i++)
		if (!strcmp(cmd, commands[i].name)) found = (int)i;
	bool ok = true;
	Buf body = {0};
	if (found < 0) ok = fail("unknown command: %s", cmd);
	else if (!sync_dpy && strcmp(cmd, "preflight") && strcmp(cmd, "disarm")) ok = fail(WAYLAND_MESSAGE);
	else if (commands[found].input && !have_xtest) ok = fail("this X server has no XTest extension, so Recordly cannot send input");
	else if (commands[found].input || commands[found].work) {
		Job *job = calloc(1, sizeof *job);
		*job = (Job){NULL, req, "", commands[found].input, commands[found].work};
		memcpy(job->id, id, sizeof id);
		if (job->work) {
			pthread_t thread;
			pthread_create(&thread, NULL, work_main, job);
			pthread_detach(thread);
			return;
		}
		pthread_mutex_lock(&jobs_lock);
		if (jobs_tail) jobs_tail->next = job;
		else jobs_head = job;
		jobs_tail = job;
		pthread_cond_signal(&jobs_cond);
		pthread_mutex_unlock(&jobs_lock);
		return;
	} else if (!strcmp(cmd, "preflight")) {
		bool atspi = false;
		if (sync_dpy && pthread_mutex_trylock(&at.lock) == 0) {
			atspi = atspi_ready();
			pthread_mutex_unlock(&at.lock);
		} else atspi = sync_dpy && at.ready;
		b_printf(&body, ",\"postEvents\":%s,\"accessibility\":%s,\"x11\":%s,\"xtest\":%s,\"xinput2\":%s,\"atspi\":%s,\"wayland\":%s",
			have_xtest ? "true" : "false", atspi ? "true" : "false", sync_dpy ? "true" : "false",
			have_xtest ? "true" : "false", have_xi2 ? "true" : "false", atspi ? "true" : "false",
			wayland_session ? "true" : "false");
	} else if (!strcmp(cmd, "cursor")) {
		double x, y;
		drain(sync_dpy);
		cursor(sync_dpy, &x, &y);
		b_printf(&body, ",\"x\":%.15g,\"y\":%.15g", x, y);
	} else if (!strcmp(cmd, "arm")) {
		drain(sync_dpy);
		ok = arm();
	} else set_armed(false, 0, 0);
	j_free(req);
	reply(id, ok, &body);
}

int main(void) {
	static sigset_t signals;
	signal(SIGPIPE, SIG_IGN);
	sigemptyset(&signals);
	sigaddset(&signals, SIGTERM);
	sigaddset(&signals, SIGINT);
	sigaddset(&signals, SIGHUP);
	pthread_sigmask(SIG_BLOCK, &signals, NULL);
	XInitThreads();
	XSetErrorHandler(on_x_error);
	const char *session = getenv("XDG_SESSION_TYPE");
	wayland_session = (session && !strcmp(session, "wayland")) || getenv("WAYLAND_DISPLAY");
	if ((sync_dpy = XOpenDisplay(NULL)) && (in_dpy = XOpenDisplay(NULL))) {
		int event, error, major, minor, opcode;
		if ((have_xtest = XTestQueryExtension(in_dpy, &event, &error, &major, &minor))) XTestGrabControl(in_dpy, True);
		major = 2;
		minor = 2;
		if (XQueryExtension(sync_dpy, "XInputExtension", &opcode, &event, &error) &&
			XIQueryVersion(sync_dpy, &major, &minor) == Success && (major > 2 || minor >= 1)) {
			have_xi2 = true;
			xi_opcode = opcode;
			xi_minor = major > 2 ? 2 : minor;
		}
	} else if (sync_dpy) {
		XCloseDisplay(sync_dpy);
		sync_dpy = NULL;
	}
	pthread_t thread;
	pthread_create(&thread, NULL, signal_main, &signals);
	if (in_dpy) pthread_create(&thread, NULL, input_main, NULL);
	char *line = NULL;
	size_t cap = 0;
	ssize_t len;
	while ((len = getline(&line, &cap, stdin)) >= 0) {
		while (len && (line[len - 1] == '\n' || line[len - 1] == '\r')) line[--len] = 0;
		if (strspn(line, " \t") < (size_t)len) handle(line);
	}
	release_and_exit();
}
