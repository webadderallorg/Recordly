import { useI18n, useScopedT } from "@/contexts/I18nContext";

export function useSettingsTranslations() {
	const te = useScopedT("editing");
	const tSettings = useScopedT("settings");
	const { locale, setLocale, t } = useI18n();
	const formatNumber = (value: number, fractionDigits?: number) =>
		new Intl.NumberFormat(locale, {
			useGrouping: false,
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits ?? 20,
		}).format(value);
	return { te, tSettings, t, locale, setLocale, formatNumber };
}
