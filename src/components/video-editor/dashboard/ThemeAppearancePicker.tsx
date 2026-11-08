import { Label, Radio, RadioGroup } from "@heroui/react";
import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { type ThemePreference, useTheme } from "@/contexts/ThemeContext";
import { getAssetPath } from "@/lib/assetPath";
import { EditorLoadingSkeleton } from "../layout/EditorLoadingSkeleton";

/** Scale the current editor loading layout as one desktop-sized scene at every preview size. */
function ThemeScene({ dark = false }: { dark?: boolean }) {
	return (
		<div
			data-theme={dark ? "dark" : "light"}
			className={`theme-preview-scene${dark ? " dark" : ""}`}
		>
			<svg viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
				<foreignObject width="1440" height="900">
					<EditorLoadingSkeleton />
				</foreignObject>
			</svg>
		</div>
	);
}

function ThemeWindow({ theme }: { theme: ThemePreference }) {
	return (
		<div className="theme-preview-window">
			{theme === "system" ? (
				<>
					<div className="theme-preview-layer theme-preview-layer-light">
						<ThemeScene />
					</div>
					<div className="theme-preview-layer theme-preview-layer-dark">
						<ThemeScene dark />
					</div>
				</>
			) : (
				<ThemeScene dark={theme === "dark"} />
			)}
		</div>
	);
}

/** Theme options remain one keyboard-accessible radio group. */
export function ThemeAppearancePicker({ compact = false }: { compact?: boolean }) {
	const { preference, setPreference } = useTheme();
	const { t } = useI18n();
	const [wallpaper, setWallpaper] = useState<string>();
	useEffect(() => {
		if (compact) return;
		let active = true;
		void getAssetPath("wallpapers/sonoma-clouds.jpg").then((url) => {
			if (active) setWallpaper(url);
		});
		return () => {
			active = false;
		};
	}, [compact]);
	const options: { value: ThemePreference; label: string }[] = [
		{ value: "system", label: t("settings.appPreferences.system", "System") },
		{ value: "light", label: t("settings.appPreferences.light", "Light") },
		{ value: "dark", label: t("settings.appPreferences.dark", "Dark") },
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
			className={`theme-appearance-picker${compact ? " theme-appearance-picker--compact" : ""}`}
		>
			{options.map(({ value, label }) => (
				<Radio key={value} value={value} className="theme-appearance-option">
					<Radio.Content className="theme-appearance-content">
						{!compact && (
							<div
								aria-hidden="true"
								className={`theme-preview theme-preview-${value}`}
								style={
									wallpaper
										? { backgroundImage: `url("${wallpaper}")` }
										: undefined
								}
							>
								<ThemeWindow theme={value} />
							</div>
						)}
						<Label className="theme-appearance-label">
							<span aria-hidden="true" className="theme-appearance-check">
								<svg viewBox="0 0 12 12" fill="none">
									<path
										d="m3 6 2 2 4-4"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</span>
							{label}
						</Label>
					</Radio.Content>
				</Radio>
			))}
		</RadioGroup>
	);
}
