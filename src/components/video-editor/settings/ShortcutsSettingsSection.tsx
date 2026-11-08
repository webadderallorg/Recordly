import { ShortcutsConfigDialog } from "../ShortcutsConfigDialog";
import { useSettingsCategoryActive } from "../SettingsSections";

export function ShortcutsSettingsSection() {
	const active = useSettingsCategoryActive("shortcuts");
	return <ShortcutsConfigDialog inline active={active} />;
}
