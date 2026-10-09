/*
 * Recordly Linux cursor monitor (X11).
 *
 * Reports cursor position and visual shape on stdout, one line per event,
 * matching the protocol consumed by electron/ipc/cursor/monitor.ts:
 *
 *   STATE:<type>       emitted only when the cursor shape changes
 *   POSITION:<x>:<y>   emitted every loop pass (root window coordinates)
 *
 * Position comes from XQueryPointer (core X11, always available). Shape
 * detection is event-driven: XFixesSelectCursorInput delivers a CursorNotify
 * the instant any app changes the cursor, and the loop blocks on the X
 * socket with a 50 ms timeout that also drives the position poll. A slow
 * periodic re-classify (500 ms) is the safety net for compositors that never
 * deliver notify events.
 *
 * Each CursorNotify carries a cursor_serial that uniquely identifies that
 * exact cursor image server-side. New serials are classified once and
 * cached; known serials cost nothing. A fully transparent cursor (some apps
 * hide the pointer) is remembered as "blank" and never changes the type.
 *
 * Classification is tiered:
 *   1. exact match against the theme's standard cursors — precise when the
 *      server's cursor matches a stored size (the common case);
 *   2. tolerant match — alpha silhouettes letterboxed onto a 32x32 grid,
 *      overlap (IoU) >= 0.85 with a scaled hotspot distance <= 3 px;
 *      rescues scaled/odd-sized cursors (e.g. 20x19) that can never exactly
 *      equal a stored size. Hotspot distance breaks ties between candidates.
 * A non-blank unmatched cursor reports "arrow".
 *
 * Reference images load ONCE at startup, at several sizes (16/24/32/48 plus
 * the display default), so no reload machinery exists (the old reload path
 * is where the Xcursor theme-string crash of 443bd458 lived). All XFixes and
 * Xcursor entry points are resolved at runtime via dlopen so building only
 * needs core X11 headers plus a C compiler.
 *
 * Reads "stop" (or EOF) on stdin to terminate, like the Windows and macOS
 * helpers.
 */

#include <X11/Xlib.h>
#include <dlfcn.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>

/* ---- Locally declared prototypes for APIs loaded at runtime ---- */

/* From X11/extensions/Xfixes.h */
typedef struct {
	short x;
	short y;
	unsigned short width;
	unsigned short height;
	short xhot;
	short yhot;
	unsigned long cursor_serial;
	unsigned long *pixels;
} RecordlyXFixesCursorImage;

/* XFixesCursorNotifyEvent (same field order as Xfixes.h). */
typedef struct {
	int type;
	unsigned long serial;
	Bool send_event;
	Display *display;
	Window window;
	int subtype;
	unsigned long cursor_serial;
	unsigned long timestamp;
	int x;
	int y;
} RecordlyXFixesCursorNotifyEvent;

#define RECORDLY_XFIXES_CURSOR_NOTIFY 0
#define RECORDLY_XFIXES_CURSOR_NOTIFY_MASK (1L << 0)

typedef int (*XFixesQueryExtensionFn)(Display *, int *, int *);
typedef RecordlyXFixesCursorImage *(*XFixesGetCursorImageFn)(Display *);
typedef void (*XFixesSelectCursorInputFn)(Display *, Window, unsigned long);

/* From X11/Xcursor.h (all dim fields are uint32_t) */
typedef struct {
	uint32_t version;
	uint32_t size;
	uint32_t width;
	uint32_t height;
	uint32_t xhot;
	uint32_t yhot;
	uint32_t delay;
	uint32_t *pixels;
} RecordlyXcursorImage;

typedef struct {
	int nimage;
	RecordlyXcursorImage **images;
	char *name;
} RecordlyXcursorImages;

typedef RecordlyXcursorImages *(*XcursorLibraryLoadImagesFn)(const char *, const char *, int);
typedef void (*XcursorImagesDestroyFn)(RecordlyXcursorImages *);
typedef char *(*XcursorGetThemeFn)(Display *);
typedef int (*XcursorGetDefaultSizeFn)(Display *);

/* Candidate Xcursor library names, mapped to Recordly cursor types. The live
 * cursor is compared against these; exact tier first, then tolerant tier. */
typedef struct {
	const char *xcursor_name;
	const char *type;
} CursorCandidate;

static const CursorCandidate CURSOR_CANDIDATES[] = {
	{ "left_ptr", "arrow" },
	{ "left_ptr_watch", "arrow" },
	{ "watch", "arrow" },
	{ "xterm", "text" },
	{ "text", "text" },
	{ "hand2", "pointer" },
	{ "hand1", "pointer" },
	{ "pointing_hand", "pointer" },
	{ "cross", "crosshair" },
	{ "cross_reverse", "crosshair" },
	{ "tcross", "crosshair" },
	{ "fleur", "open-hand" },
	{ "all-scroll", "open-hand" },
	{ "grab", "open-hand" },
	{ "grabbing", "closed-hand" },
	{ "closedhand", "closed-hand" },
	{ "sb_h_double_arrow", "resize-ew" },
	{ "h_double_arrow", "resize-ew" },
	{ "ew-resize", "resize-ew" },
	{ "sb_v_double_arrow", "resize-ns" },
	{ "v_double_arrow", "resize-ns" },
	{ "ns-resize", "resize-ns" },
	{ "circle", "not-allowed" },
	{ "forbidden", "not-allowed" },
	{ "no-drop", "not-allowed" },
};

#define CANDIDATE_COUNT (sizeof(CURSOR_CANDIDATES) / sizeof(CURSOR_CANDIDATES[0]))

#define REFERENCE_SIZES_MAX 8
#define REFERENCES_MAX 4096

/* One reference frame loaded from the theme, with its Recordly type. Frames
 * are owned by their XcursorImages sets; the sets are intentionally never
 * destroyed, so the frames stay valid for the process lifetime (bounded,
 * one-time allocation). */
typedef struct {
	RecordlyXcursorImage *image;
	const char *type;
} ReferenceFrame;

static ReferenceFrame g_references[REFERENCES_MAX];
static size_t g_reference_count = 0;

/* Serial → type cache. type == CURSOR_TYPE_BLANK means "classified as a
 * transparent cursor: ignore it". A NULL type slot is free. */
#define SERIAL_CACHE_MAX 256
#define CURSOR_TYPE_BLANK ""

typedef struct {
	unsigned long serial;
	const char *type;
} SerialEntry;

static SerialEntry g_serial_cache[SERIAL_CACHE_MAX];

static volatile bool g_running = true;
static bool g_debug = false;

/* Debug helper: RECORDLY_CURSOR_DEBUG=1 prints classification evidence to
 * stderr (reference loads, serial → type decisions, fuzzy-match scores).
 * The app drains stderr, so run the helper from a terminal to see it. */
static void dbg(const char *format, ...) {
	if (!g_debug) {
		return;
	}
	va_list args;
	va_start(args, format);
	vfprintf(stderr, format, args);
	va_end(args);
	fputc('\n', stderr);
}

static void *stdin_listener(void *unused) {
	(void)unused;
	char line[64];
	while (fgets(line, sizeof(line), stdin) != NULL) {
		if (strncmp(line, "stop", 4) == 0) {
			g_running = false;
			return NULL;
		}
	}
	/* EOF: the parent (Electron) went away. */
	g_running = false;
	return NULL;
}

/* XFixes returns ARGB pixels, but the array layout varies across libXfixes
 * versions: some pack CARD32s contiguously, others store one pixel per
 * unsigned long. Both readings are tried everywhere; a real cursor is
 * non-blank under at least one, and exact/tolerant matching accepts the
 * layout that matches. */
static uint32_t xfixes_pixel_packed(const void *image, size_t index) {
	const RecordlyXFixesCursorImage *live = image;
	return ((const uint32_t *)live->pixels)[index];
}

static uint32_t xfixes_pixel_unpacked(const void *image, size_t index) {
	const RecordlyXFixesCursorImage *live = image;
	return (uint32_t)live->pixels[index];
}

static uint32_t xcursor_pixel_at(const void *image, size_t index) {
	return ((const RecordlyXcursorImage *)image)->pixels[index];
}

static bool silhouette_matches(const RecordlyXFixesCursorImage *live,
							   const RecordlyXcursorImage *ref, bool unpacked) {
	if (live->width != ref->width || live->height != ref->height) {
		return false;
	}
	/* Hotspots disambiguate cursors with identical silhouettes but different
	 * anchors (e.g. left_ptr vs bottom_left_corner). */
	if ((uint32_t)live->xhot != ref->xhot || (uint32_t)live->yhot != ref->yhot) {
		return false;
	}
	/* Compare alpha only: apps may recolor cursors (e.g. a white I-beam over
	 * dark terminals), and the server stores premultiplied ARGB while
	 * Xcursor images use straight alpha. */
	size_t count = (size_t)live->width * live->height;
	for (size_t i = 0; i < count; i++) {
		uint32_t live_px = unpacked ? xfixes_pixel_unpacked(live, i) : xfixes_pixel_packed(live, i);
		if ((live_px >> 24) != (ref->pixels[i] >> 24)) {
			return false;
		}
	}
	return true;
}

/* ---- Tolerant tier: 32x32 letterboxed alpha-silhouette overlap ---- */

#define CLASSIFY_GRID 32
#define CLASSIFY_IOU_MIN 0.85
#define CLASSIFY_HOTSPOT_TOLERANCE_PX 3.0
#define CLASSIFY_IOU_TIEBREAK 0.02

typedef struct {
	uint8_t cell[CLASSIFY_GRID][CLASSIFY_GRID]; /* 0 or 1 */
} SilhouetteGrid;

typedef uint32_t (*PixelAtFn)(const void *image, size_t index);

/* Letterbox the image into the grid: aspect ratio preserved, centered, a
 * cell set when any source pixel mapping into it is opaque. Aspect-correct
 * mapping matters — squeezing a 20x19 arrow into a square would shear the
 * silhouette away from the theme's stored shape. */
static void build_silhouette(uint32_t width, uint32_t height, const void *image, PixelAtFn pixel_at,
							 SilhouetteGrid *out) {
	memset(out, 0, sizeof(*out));
	if (width == 0 || height == 0) {
		return;
	}
	uint32_t longest = width > height ? width : height;
	double scale = (double)CLASSIFY_GRID / (double)longest;
	uint32_t draw_w = (uint32_t)((double)width * scale);
	uint32_t draw_h = (uint32_t)((double)height * scale);
	if (draw_w > CLASSIFY_GRID) {
		draw_w = CLASSIFY_GRID;
	}
	if (draw_h > CLASSIFY_GRID) {
		draw_h = CLASSIFY_GRID;
	}
	uint32_t offset_x = (CLASSIFY_GRID - draw_w) / 2;
	uint32_t offset_y = (CLASSIFY_GRID - draw_h) / 2;
	size_t index = 0;
	for (uint32_t y = 0; y < height; y++) {
		uint32_t cell_y = offset_y + (uint32_t)((double)y * scale);
		if (cell_y >= CLASSIFY_GRID) {
			break;
		}
		for (uint32_t x = 0; x < width; x++) {
			uint32_t cell_x = offset_x + (uint32_t)((double)x * scale);
			if (cell_x < CLASSIFY_GRID && (pixel_at(image, index) >> 24) > 0) {
				out->cell[cell_y][cell_x] = 1;
			}
			index++;
		}
	}
}

static double silhouette_intersection_over_union(const SilhouetteGrid *a, const SilhouetteGrid *b) {
	size_t intersection = 0;
	size_t union_count = 0;
	for (size_t y = 0; y < CLASSIFY_GRID; y++) {
		for (size_t x = 0; x < CLASSIFY_GRID; x++) {
			bool in_a = a->cell[y][x] != 0;
			bool in_b = b->cell[y][x] != 0;
			if (in_a || in_b) {
				union_count++;
			}
			if (in_a && in_b) {
				intersection++;
			}
		}
	}
	if (union_count == 0) {
		return 0.0;
	}
	return (double)intersection / (double)union_count;
}

/* Classify one live image.
 * Returns CURSOR_TYPE_BLANK for a fully transparent cursor (caller ignores
 * it), the Recordly type on match, or "arrow" for a non-blank no-match.
 * `evidence` receives a short static string for the debug log. */
static const char *classify_live_cursor(const RecordlyXFixesCursorImage *live,
										const char **evidence) {
	static char evidence_buf[96];

	size_t pixel_count = (size_t)live->width * live->height;
	bool live_blank = true;
	for (size_t layout = 0; layout < 2 && live_blank; layout++) {
		PixelAtFn at = layout == 0 ? xfixes_pixel_packed : xfixes_pixel_unpacked;
		for (size_t i = 0; i < pixel_count; i++) {
			if ((at(live, i) >> 24) > 0) {
				live_blank = false;
				break;
			}
		}
	}
	if (live_blank) {
		*evidence = "transparent";
		return CURSOR_TYPE_BLANK;
	}

	/* Tier 1: exact (size + hotspot + alpha bytes identical). */
	for (size_t r = 0; r < g_reference_count; r++) {
		for (int layout = 0; layout < 2; layout++) {
			if (silhouette_matches(live, g_references[r].image, layout == 1)) {
				*evidence = "exact";
				return g_references[r].type;
			}
		}
	}

	/* Tier 2: tolerant match on 32x32 silhouettes, both live pixel layouts.
	 * Candidates must clear the IoU bar AND a scaled hotspot distance of
	 * ±3 px (hotspot scaled from the reference's size to the live size —
	 * only meaningful when the sizes are close; a 48 px reference of a 24 px
	 * live cursor scales its hotspot by 0.5). Among qualifying candidates
	 * the best IoU wins; within the tiebreak margin the smaller hotspot
	 * distance wins. */
	SilhouetteGrid live_grid[2];
	PixelAtFn live_at[2] = { xfixes_pixel_packed, xfixes_pixel_unpacked };
	for (size_t layout = 0; layout < 2; layout++) {
		build_silhouette(live->width, live->height, live, live_at[layout], &live_grid[layout]);
	}
	const ReferenceFrame *best_frame = NULL;
	double best_iou = 0.0;
	double best_hotspot = 0.0;
	for (size_t r = 0; r < g_reference_count; r++) {
		const RecordlyXcursorImage *ref = g_references[r].image;
		SilhouetteGrid ref_grid;
		build_silhouette(ref->width, ref->height, ref, xcursor_pixel_at, &ref_grid);
		double hx = (double)ref->xhot * (double)live->width / (double)ref->width;
		double hy = (double)ref->yhot * (double)live->height / (double)ref->height;
		double dx = hx - (double)live->xhot;
		double dy = hy - (double)live->yhot;
		double hotspot_px = dx * dx + dy * dy; /* squared; bar is 3^2 */
		if (hotspot_px > CLASSIFY_HOTSPOT_TOLERANCE_PX * CLASSIFY_HOTSPOT_TOLERANCE_PX) {
			continue;
		}
		for (size_t layout = 0; layout < 2; layout++) {
			double iou = silhouette_intersection_over_union(&live_grid[layout], &ref_grid);
			if (iou < CLASSIFY_IOU_MIN) {
				continue;
			}
			if (best_frame == NULL || iou > best_iou + CLASSIFY_IOU_TIEBREAK ||
				(iou > best_iou - CLASSIFY_IOU_TIEBREAK && hotspot_px < best_hotspot)) {
				best_frame = &g_references[r];
				best_iou = iou;
				best_hotspot = hotspot_px;
			}
		}
	}
	if (best_frame != NULL) {
		snprintf(evidence_buf, sizeof(evidence_buf), "fuzzy iou=%.2f", best_iou);
		*evidence = evidence_buf;
		return best_frame->type;
	}
	*evidence = "unmatched";
	return "arrow";
}

/* ---- Serial cache ---- */

static const char *serial_cache_lookup(unsigned long serial) {
	for (size_t i = 0; i < SERIAL_CACHE_MAX; i++) {
		if (g_serial_cache[i].type != NULL && g_serial_cache[i].serial == serial) {
			return g_serial_cache[i].type;
		}
	}
	return NULL;
}

static void serial_cache_store(unsigned long serial, const char *type) {
	for (size_t i = 0; i < SERIAL_CACHE_MAX; i++) {
		if (g_serial_cache[i].type == NULL) {
			g_serial_cache[i].serial = serial;
			g_serial_cache[i].type = type;
			return;
		}
	}
	/* Full: start over. Themes hold a few hundred distinct serials at most,
	 * and hot serials re-classify in one pass. */
	memset(g_serial_cache, 0, sizeof(g_serial_cache));
	g_serial_cache[0].serial = serial;
	g_serial_cache[0].type = type;
}

/* Classify + emit for one freshly fetched live image. Shared by the
 * event-driven path and the periodic safety net. */
static void handle_live_image(Display *display, XFixesGetCursorImageFn get_cursor_image,
							  RecordlyXFixesCursorImage *image, const char **last_type) {
	const char *type = serial_cache_lookup(image->cursor_serial);
	if (type == NULL) {
		const char *evidence = "";
		type = classify_live_cursor(image, &evidence);
		serial_cache_store(image->cursor_serial, type);
		if (type[0] == '\0') {
			dbg("serial %lu: transparent cursor → ignored", image->cursor_serial);
		} else {
			dbg("serial %lu → %s (%s)", image->cursor_serial, type, evidence);
		}
	}
	(void)display;
	(void)get_cursor_image;
	if (type[0] != '\0' && strcmp(type, *last_type) != 0) {
		*last_type = type;
		printf("STATE:%s\n", type);
	}
}

int main(void) {
	setvbuf(stdout, NULL, _IONBF, 0);
	g_debug = getenv("RECORDLY_CURSOR_DEBUG") != NULL;
	dbg("debug enabled (pid %d)", getpid());

	Display *display = XOpenDisplay(NULL);
	if (display == NULL) {
		/* No X server (e.g. Wayland without XWayland): exit so the
		 * TypeScript side falls back to "arrow" and uiohook positions. */
		fprintf(stderr, "cursor-monitor: cannot open X display\n");
		return 1;
	}

	int event_base = 0;
	int error_base = 0;
	XFixesQueryExtensionFn query_extension = NULL;
	XFixesGetCursorImageFn get_cursor_image = NULL;
	XFixesSelectCursorInputFn select_cursor_input = NULL;
	XcursorLibraryLoadImagesFn load_images = NULL;
	XcursorImagesDestroyFn destroy_images = NULL;
	XcursorGetThemeFn get_theme = NULL;
	XcursorGetDefaultSizeFn get_default_size = NULL;

	void *xfixes = dlopen("libXfixes.so.3", RTLD_NOW | RTLD_GLOBAL);
	if (xfixes == NULL) {
		xfixes = dlopen("libXfixes.so", RTLD_NOW | RTLD_GLOBAL);
	}
	if (xfixes != NULL) {
		query_extension = (XFixesQueryExtensionFn)dlsym(xfixes, "XFixesQueryExtension");
		get_cursor_image = (XFixesGetCursorImageFn)dlsym(xfixes, "XFixesGetCursorImage");
		select_cursor_input = (XFixesSelectCursorInputFn)dlsym(xfixes, "XFixesSelectCursorInput");
	}
	if (query_extension == NULL || get_cursor_image == NULL ||
		!query_extension(display, &event_base, &error_base)) {
		/* Position tracking still works without XFixes; shape stays "arrow". */
		dbg("XFixes unavailable (query=%p, get=%p) — shape will stay \"arrow\"",
			(void *)query_extension, (void *)get_cursor_image);
		get_cursor_image = NULL;
		select_cursor_input = NULL;
	}

	void *xcursor = dlopen("libXcursor.so.1", RTLD_NOW | RTLD_GLOBAL);
	if (xcursor == NULL) {
		xcursor = dlopen("libXcursor.so", RTLD_NOW | RTLD_GLOBAL);
	}
	if (xcursor != NULL) {
		load_images = (XcursorLibraryLoadImagesFn)dlsym(xcursor, "XcursorLibraryLoadImages");
		destroy_images = (XcursorImagesDestroyFn)dlsym(xcursor, "XcursorImagesDestroy");
		get_theme = (XcursorGetThemeFn)dlsym(xcursor, "XcursorGetTheme");
		get_default_size = (XcursorGetDefaultSizeFn)dlsym(xcursor, "XcursorGetDefaultSize");
	}
	if (load_images == NULL || destroy_images == NULL) {
		dbg("libXcursor load/destroy symbols missing — shape will stay \"arrow\"");
		load_images = NULL;
	}

	bool shape_ready = get_cursor_image != NULL && load_images != NULL;

	if (shape_ready) {
		/* XcursorGetTheme returns a string owned by libXcursor — the caller
		 * must NOT free it (freeing it corrupts the library's heap; that was
		 * the crash fixed in 443bd458). NULL just means the default theme. */
		char *theme = get_theme != NULL ? get_theme(display) : NULL;
		uint32_t sizes[REFERENCE_SIZES_MAX];
		size_t size_count = 0;
		sizes[size_count++] = 16;
		sizes[size_count++] = 24;
		sizes[size_count++] = 32;
		sizes[size_count++] = 48;
		uint32_t default_size = 24;
		if (get_default_size != NULL) {
			int reported = get_default_size(display);
			if (reported > 0) {
				default_size = (uint32_t)reported;
			}
		}
		bool have_default = false;
		for (size_t i = 0; i < size_count; i++) {
			if (sizes[i] == default_size) {
				have_default = true;
			}
		}
		if (!have_default && size_count < REFERENCE_SIZES_MAX) {
			sizes[size_count++] = default_size;
		}

		for (size_t i = 0; i < CANDIDATE_COUNT && g_reference_count < REFERENCES_MAX; i++) {
			for (size_t s = 0; s < size_count && g_reference_count < REFERENCES_MAX; s++) {
				RecordlyXcursorImages *set =
					load_images(CURSOR_CANDIDATES[i].xcursor_name, theme, (int)sizes[s]);
				if (set == NULL) {
					continue;
				}
				for (int f = 0; f < set->nimage && g_reference_count < REFERENCES_MAX; f++) {
					if (set->images[f] != NULL) {
						g_references[g_reference_count].image = set->images[f];
						g_references[g_reference_count].type = CURSOR_CANDIDATES[i].type;
						g_reference_count++;
					}
				}
				/* The set is intentionally NOT destroyed: its frames stay
				 * referenced by g_references for the process lifetime. */
			}
		}
		dbg("references: %zu frame(s) across %zu size(s), theme=%s, default size=%u",
			g_reference_count, size_count, theme != NULL ? theme : "(null → default theme)",
			default_size);

		if (select_cursor_input != NULL) {
			select_cursor_input(display, DefaultRootWindow(display),
								RECORDLY_XFIXES_CURSOR_NOTIFY_MASK);
		} else {
			dbg("XFixesSelectCursorInput missing — falling back to periodic classification");
		}
	}

	pthread_t listener;
	if (pthread_create(&listener, NULL, stdin_listener, NULL) != 0) {
		fprintf(stderr, "cursor-monitor: cannot start stdin listener\n");
		XCloseDisplay(display);
		return 1;
	}
	pthread_detach(listener);

	const char *last_type = "";
	int x_fd = ConnectionNumber(display);

	while (g_running) {
		fd_set read_fds;
		FD_ZERO(&read_fds);
		FD_SET(x_fd, &read_fds);
		struct timeval timeout = { 0, 50 * 1000 };
		int ready = select(x_fd + 1, &read_fds, NULL, NULL, &timeout);

		if (ready > 0 && shape_ready) {
			/* Shape changes arrive here the instant any app switches the
			 * cursor. */
			while (g_running && XPending(display) > 0) {
				XEvent event;
				XNextEvent(display, &event);
				if (event.type == event_base + RECORDLY_XFIXES_CURSOR_NOTIFY) {
					RecordlyXFixesCursorImage *image = get_cursor_image(display);
					if (image != NULL) {
						handle_live_image(display, get_cursor_image, image, &last_type);
						XFree(image);
					}
				}
			}
		}

		Window root_return = None;
		Window child_return = None;
		int root_x = 0;
		int root_y = 0;
		int win_x = 0;
		int win_y = 0;
		unsigned int mask = 0;
		Bool pointer_ok = XQueryPointer(display, DefaultRootWindow(display), &root_return,
										&child_return, &root_x, &root_y, &win_x, &win_y, &mask);

		if (pointer_ok) {
			printf("POSITION:%d:%d\n", root_x, root_y);
		}

		/* Safety net for compositors that never deliver cursor notify:
		 * re-classify on a slow cadence; the serial cache makes repeats
		 * free. The first pass runs immediately, giving the initial STATE
		 * line before any event arrives. */
		if (shape_ready) {
			static long last_periodic_ms = 0;
			struct timespec now;
			clock_gettime(CLOCK_MONOTONIC, &now);
			long now_ms = (long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
			if (now_ms - last_periodic_ms >= 500) {
				last_periodic_ms = now_ms;
				RecordlyXFixesCursorImage *image = get_cursor_image(display);
				if (image != NULL) {
					handle_live_image(display, get_cursor_image, image, &last_type);
					XFree(image);
				}
			}
		}
	}

	XCloseDisplay(display);
	return 0;
}
