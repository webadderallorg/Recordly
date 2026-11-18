import { Tabs as HeroTabs } from "@heroui/react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/contexts/I18nContext";
import { useScrollFade } from "./settings/useScrollFade";

export type SettingsSection =
	| "appearance"
	| "general"
	| "shortcuts"
	| "account"
	| "permissions"
	| "motion"
	| "recording"
	| "storage"
	| "files"
	| "updates"
	| "developer";
const SettingsCategoryContext = createContext<SettingsSection | null>(null);

export function useSettingsCategoryActive(category: SettingsSection) {
	return useContext(SettingsCategoryContext) === category;
}

/** Dashboard and editor share the same controls and category selection. */
export function SettingsSections({
	children,
	categories,
	variant = "choices",
	initialCategory = "general",
	sidebarFooter,
}: {
	children: ReactNode;
	categories: SettingsSection[];
	variant?: "choices" | "tabs";
	initialCategory?: SettingsSection;
	sidebarFooter?: (select: (section: SettingsSection) => void) => ReactNode;
}) {
	const { t } = useI18n();
	const labels: Record<SettingsSection, string> = {
		appearance: t("settings.appPreferences.appearance", "Appearance"),
		general: t("settings.categories.general", "General"),
		shortcuts: t("settings.categories.shortcuts", "Shortcuts"),
		account: t("settings.categories.account", "Account"),
		permissions: t("settings.categories.permissions", "Permissions"),
		motion: t("settings.categories.motion", "Motion"),
		recording: t("settings.categories.recording", "Recording"),
		storage: t("settings.storage.title", "Storage locations"),
		files: t("settings.appPreferences.storage", "Storage"),
		updates: t("settings.updates.title", "Updates"),
		developer: t("settings.effects.devSection", "Dev"),
	};
	const parent = useContext(SettingsCategoryContext);
	const [selected, setSelected] = useState<SettingsSection>(initialCategory);
	useEffect(() => setSelected(initialCategory), [initialCategory]);
	const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 680px)").matches);
	useEffect(() => {
		const query = window.matchMedia("(max-width: 680px)");
		const update = () => setNarrow(query.matches);
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	const panel = useRef<HTMLDivElement>(null);
	const available = categories.filter(
		(category) => category !== "developer" || import.meta.env.DEV,
	);
	const active = available.includes(selected) ? selected : available[0];
	const CategoryList = narrow ? TabsList : HeroTabs.List;
	const scrollFade = useScrollFade(panel, active);
	useLayoutEffect(() => {
		if (active && panel.current) panel.current.scrollTop = 0;
	}, [active]);
	if (parent) return <div className="settings-section-flow space-y-6">{children}</div>;
	if (variant === "tabs") {
		return (
			<SettingsCategoryContext.Provider value={active}>
				<Tabs
					value={active}
					onValueChange={(value) => setSelected(value as SettingsSection)}
					variant="secondary"
					orientation={narrow ? "horizontal" : "vertical"}
					className="dashboard-settings-tabs"
				>
					<div className="dashboard-settings-navigation">
						<CategoryList
							aria-label={t("settings.categories.label", "Settings sections")}
							className="dashboard-settings-tab-list"
						>
							{available.map((category) => (
								<TabsTrigger key={category} value={category}>
									{labels[category]}
								</TabsTrigger>
							))}
						</CategoryList>
						{sidebarFooter && (
							<div className="dashboard-settings-sidebar-footer">
								{sidebarFooter(setSelected)}
							</div>
						)}
					</div>
					<TabsContent
						ref={panel}
						value={active}
						aria-label={t("settings.categories.panel", "{{category}} settings", {
							category: labels[active],
						})}
						className="dashboard-settings-tab-panel space-y-6 scroll-shadow scroll-shadow--vertical scroll-shadow--fade [--scroll-shadow-size:32px]"
						data-settings-section={active}
						data-scroll-shadow-mode={scrollFade}
					>
						{children}
					</TabsContent>
				</Tabs>
			</SettingsCategoryContext.Provider>
		);
	}
	return (
		<SettingsCategoryContext.Provider value={active}>
			<div className="space-y-6">
				<ChoiceGroup
					aria-label={t("settings.categories.label", "Settings sections")}
					value={active}
					onValueChange={(value) => setSelected(value as SettingsSection)}
					size="sm"
				>
					{available.map((category) => (
						<ChoiceItem key={category} value={category}>
							{labels[category]}
						</ChoiceItem>
					))}
				</ChoiceGroup>
				<div
					role="region"
					aria-label={t("settings.categories.panel", "{{category}} settings", {
						category: labels[active],
					})}
					className="space-y-6"
				>
					{children}
				</div>
			</div>
		</SettingsCategoryContext.Provider>
	);
}

export function SettingsCategory({
	category,
	children,
}: {
	category: SettingsSection | SettingsSection[];
	children: ReactNode;
}) {
	const active = useContext(SettingsCategoryContext);
	const visible = Array.isArray(category)
		? active !== null && category.includes(active)
		: active === category;
	// Mount on first visit, then retain drafts and loaded preferences across tabs.
	const [visited, setVisited] = useState(false);
	if (visible && !visited) setVisited(true);
	if (!visible && !visited) return null;
	return (
		<div hidden={!visible} className="settings-category space-y-6">
			{children}
		</div>
	);
}
