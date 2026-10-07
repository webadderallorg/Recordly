import { createContext, useContext, useState, type ReactNode } from "react";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { useI18n } from "@/contexts/I18nContext";

type Category = "general" | "ai" | "motion" | "recording" | "files" | "advanced";
const defaultLabels: Record<Category, string> = {
	general: "General",
	ai: "AI & Models",
	motion: "Motion",
	recording: "Recording",
	files: "Files",
	advanced: "Advanced",
};
const SettingsCategoryContext = createContext<Category | null>(null);

/** Dashboard and editor share the same controls and category selection. */
export function SettingsSections({
	children,
	categories,
}: {
	children: ReactNode;
	categories: Category[];
}) {
	const { t } = useI18n();
	const parent = useContext(SettingsCategoryContext);
	const [selected, setSelected] = useState<Category>("general");
	if (parent) return <div className="space-y-6">{children}</div>;
	const active = categories.includes(selected) ? selected : categories[0];
	return (
		<SettingsCategoryContext.Provider value={active}>
			<div className="space-y-6">
				<ChoiceGroup
					aria-label="Settings sections"
					value={active}
					onValueChange={(value) => setSelected(value as Category)}
					size="sm"
				>
					{categories.map((category) => (
						<ChoiceItem key={category} value={category}>
							{t(`settings.categories.${category}`, defaultLabels[category])}
						</ChoiceItem>
					))}
				</ChoiceGroup>
				<div role="region" aria-label={`${defaultLabels[active]} settings`} className="space-y-6">
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
	category: Category | Category[];
	children: ReactNode;
}) {
	const active = useContext(SettingsCategoryContext);
	const visible = Array.isArray(category)
		? active !== null && category.includes(active)
		: active === category;
	return visible ? <div className="space-y-6">{children}</div> : null;
}
