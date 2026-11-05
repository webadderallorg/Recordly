import { LocalizedError } from "@/components/feedback/LocalizedError";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/contexts/I18nContext";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { DashboardToolbar } from "./DashboardToolbar";

const catalogs = import.meta.glob("../../../i18n/locales/*/ui.json", {
	eager: true,
	import: "default",
}) as Record<string, Record<string, string>>;

afterEach(() => vi.unstubAllGlobals());

describe("dashboard localization", () => {
	it.each(SUPPORTED_LOCALES)("renders the library in %s with localized counts", (locale) => {
		vi.stubGlobal("window", { localStorage: { getItem: () => locale } });
		const messages = catalogs[`../../../i18n/locales/${locale}/ui.json`];
		const errorHtml = renderToStaticMarkup(
			<I18nProvider>
				<LocalizedError error="Backend diagnostic" />
			</I18nProvider>,
		);
		expect(errorHtml).toContain(messages.couldNotCompleteAction);
		expect(errorHtml).toContain(messages.technicalDetails);
		expect(errorHtml).toContain('aria-expanded="false"');
		expect(errorHtml).toContain('hidden=""');
		for (const count of [0, 1, 2, 1200]) {
			const html = renderToStaticMarkup(
				<I18nProvider>
					<DashboardToolbar
						isRaw={false}
						query=""
						setQuery={() => undefined}
						onImportFile={async () => undefined}
						run={async (action) => action()}
						busy={false}
						count={count}
					/>
				</I18nProvider>,
			);
			expect(html).toContain(messages.yourProjects);
			expect(html).toContain(messages.searchProjects);
			const category = new Intl.PluralRules(locale).select(count);
			const expected = (
				messages[`projectCount_${category}`] ?? messages.projectCount_other
			).replace("{{number}}", new Intl.NumberFormat(locale).format(count));
			expect(html).toContain(expected);
			expect(html).not.toContain("ui.projectCount");
		}
	});
});
