import assert from "node:assert/strict";
import test from "node:test";
import { resolveShowcaseRewind } from "./showcaseScroll.js";

const rewind = (values) => resolveShowcaseRewind({
	scrollY: 1000, start: 1000, distance: 1000, progressDistance: 1000, progress: .5,
	...values,
});

test("upward scrolling stays pinned while progress remains", () => {
	assert.deepEqual(rewind({ deltaY: -100 }), { scrollY: 1000, progress: .4 });
});

test("rounded scroll positions still hold the fractional top boundary", () => {
	const result = rewind({ scrollY: 999.5, deltaY: -100 });
	assert.equal(result.scrollY, 1000);
	assert.ok(result.progress > 0);
});

test("a gesture crossing the top uses its full movement to rewind", () => {
	const result = rewind({ scrollY: 1120, progress: .8, deltaY: -200 });
	assert.equal(result.scrollY, 1000);
	assert.ok(Math.abs(result.progress - .6) < 1e-10);
});

test("remaining gesture distance scrolls above only after progress reaches zero", () => {
	assert.deepEqual(rewind({ scrollY: 1120, progress: .2, deltaY: -300 }), { scrollY: 900, progress: 0 });
});

test("fractional progress reaches exactly zero when fully rewound", () => {
	assert.equal(rewind({ progress: .387654321, deltaY: -500 }).progress, 0);
});

test("reentering a shortened completed section preserves its original rewind scale", () => {
	const result = rewind({ scrollY: 2000, distance: 200, progress: 1, deltaY: -1100 });
	assert.equal(result.scrollY, 1000);
	assert.ok(Math.abs(result.progress - .7) < 1e-10);
});

test("native scrolling is preserved outside the upper boundary and at zero", () => {
	for (const values of [
		{ deltaY: 100 }, { deltaY: -50, scrollY: 1200 },
		{ deltaY: -100, progress: 0 }, { deltaY: -100, scrollY: 900 },
		{ deltaY: -800, scrollY: 1500, progress: .1 },
	]) assert.equal(rewind(values), null);
});

test("no upward gesture exits above with unfinished progress", () => {
	for (const progress of [.001, .25, .5, 1]) {
		for (const offset of [0, 50, 500]) {
			for (const deltaY of [-.5, -10, -100, -1000, -5000]) {
				const result = rewind({ progress, scrollY: 1000 + offset, deltaY });
				if (!result) continue;
				assert.ok(result.progress >= 0 && result.progress <= progress);
				if (result.progress > 1e-10) assert.ok(result.scrollY >= 1000);
				if (result.scrollY < 1000) assert.equal(result.progress, 0);
			}
		}
	}
});
