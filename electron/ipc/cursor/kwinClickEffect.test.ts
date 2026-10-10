import { describe, expect, it } from "vitest";
import {
	buildKwinClickEffectScript,
	createKwinJournalButtonsParser,
	diffKwinButtons,
	KWIN_CLICK_JOURNAL_MARKER,
} from "./kwinClickEffect";

describe("diffKwinButtons", () => {
	it("maps newly pressed Qt buttons to hook button numbers", () => {
		expect(diffKwinButtons(1, 0)).toEqual({ pressed: [1], released: 0 });
		expect(diffKwinButtons(2, 0)).toEqual({ pressed: [2], released: 0 });
		expect(diffKwinButtons(4, 0)).toEqual({ pressed: [3], released: 0 });
		expect(diffKwinButtons(3, 1)).toEqual({ pressed: [2], released: 0 });
	});

	it("counts releases and ignores unknown buttons", () => {
		expect(diffKwinButtons(0, 1)).toEqual({ pressed: [], released: 1 });
		expect(diffKwinButtons(0, 3)).toEqual({ pressed: [], released: 2 });
		expect(diffKwinButtons(8, 0)).toEqual({ pressed: [], released: 0 });
	});
});

describe("buildKwinClickEffectScript", () => {
	it("prints button changes with the journal marker", () => {
		const script = buildKwinClickEffectScript();
		expect(script).toContain("effects.mouseChanged.connect");
		expect(script).toContain(`print("${KWIN_CLICK_JOURNAL_MARKER} "`);
		// Scripted effects have no D-Bus access.
		expect(script).not.toContain("callDBus");
	});
});

describe("createKwinJournalButtonsParser", () => {
	it("emits button transitions across chunk boundaries and skips other lines", () => {
		const changes: Array<[number, number]> = [];
		const parser = createKwinJournalButtonsParser((buttons, oldButtons) =>
			changes.push([buttons, oldButtons]),
		);

		parser(`js: ${KWIN_CLICK_JOURNAL_MARKER} 1 0\nkwin_wayland: something else\n`);
		parser(`js: ${KWIN_CLICK_JOURNAL_MARKER} 0`);
		parser(" 1\n");

		expect(changes).toEqual([
			[1, 0],
			[0, 1],
		]);
	});
});
