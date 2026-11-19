import { Label, Radio, RadioGroup } from "@heroui/react";
import editorDarkPreview from "@/assets/appearance/editor-dark.png";
import editorLightPreview from "@/assets/appearance/editor-light.png";
import { useI18n } from "@/contexts/I18nContext";
import { type ThemePreference, useTheme } from "@/contexts/ThemeContext";

/** The same editor capture anchors each window-corner preview. */
function ThemeSnapshot({ dark = false }: { dark?: boolean }) {
	return (
		<img
			className="theme-preview-image"
			src={dark ? editorDarkPreview : editorLightPreview}
			alt=""
			width={384}
			height={256}
			draggable={false}
			decoding="async"
		/>
	);
}

function ThemeWindow({ theme }: { theme: ThemePreference }) {
	return (
		<div className="theme-preview-window">
			<span className="theme-preview-chrome">
				<i />
				<i />
				<i />
			</span>
			{theme === "system" ? (
				<>
					<div className="theme-preview-layer theme-preview-layer-light">
						<ThemeSnapshot />
					</div>
					<div className="theme-preview-layer theme-preview-layer-dark">
						<ThemeSnapshot dark />
					</div>
				</>
			) : (
				<ThemeSnapshot dark={theme === "dark"} />
			)}
		</div>
	);
}

/** Theme options remain one keyboard-accessible radio group. */
export function ThemeAppearancePicker() {
	const { preference, setPreference } = useTheme();
	const { t } = useI18n();
	const options: { value: ThemePreference; label: string }[] = [
		{ value: "light", label: t("settings.appPreferences.light", "Light") },
		{ value: "dark", label: t("settings.appPreferences.dark", "Dark") },
		{ value: "system", label: t("settings.appPreferences.system", "System") },
	];
	return (
		<RadioGroup
			orientation="horizontal"
			aria-label={t("settings.appPreferences.appearance", "Appearance")}
			value={preference}
			onChange={(value) => {
				if (value === "light" || value === "dark" || value === "system")
					setPreference(value);
			}}
			className="theme-appearance-picker"
		>
			{options.map(({ value, label }) => (
				<Radio key={value} value={value} className="theme-appearance-option">
					<Radio.Content className="theme-appearance-content">
						<div aria-hidden="true" className={`theme-preview theme-preview-${value}`}>
							<ThemeWindow theme={value} />
							<span className="theme-appearance-check">
								<svg viewBox="0 0 12 12" fill="none">
									<path
										d="m3 6 2 2 4-4"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</span>
						</div>
						<Label className="theme-appearance-label">{label}</Label>
					</Radio.Content>
				</Radio>
			))}
		</RadioGroup>
	);
}
