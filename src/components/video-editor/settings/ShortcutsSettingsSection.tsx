import { useSettingsCategoryActive } from "../SettingsSections";
import { ShortcutsConfigDialog } from "../ShortcutsConfigDialog";

export function ShortcutsSettingsSection() {
	const active = useSettingsCategoryActive("shortcuts");
	return <ShortcutsConfigDialog inline active={active} />;
}
