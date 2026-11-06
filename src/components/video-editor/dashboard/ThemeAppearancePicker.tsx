import { Label, Radio, RadioGroup } from "@heroui/react";
import { useI18n } from "@/contexts/I18nContext";
import { type ThemePreference, useTheme } from "@/contexts/ThemeContext";

/** A static editor wireframe with explicit palettes, independent of loading UI and app theme. */
function ThemeScene({ dark = false }: { dark?: boolean }) {
	return (
		<svg
			className={`theme-preview-scene${dark ? " theme-preview-scene--dark" : ""}`}
			viewBox="0 0 288 160"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<rect
				x="1"
				y="1"
				width="286"
				height="158"
				rx="9"
				fill="var(--preview-background)"
				stroke="var(--preview-border)"
				strokeWidth="2"
			/>
			<path d="M2 23H286" stroke="var(--preview-border)" />
			<g fill="var(--preview-muted)">
				<circle cx="12" cy="12" r="2.5" />
				<circle cx="21" cy="12" r="2.5" />
				<circle cx="30" cy="12" r="2.5" />
				<rect x="43" y="10" width="48" height="4" rx="2" />
				<rect x="244" y="8" width="30" height="8" rx="3" />
				<rect x="9" y="34" width="9" height="9" rx="2" />
				<rect x="9" y="51" width="9" height="9" rx="2" />
				<rect x="9" y="68" width="9" height="9" rx="2" />
			</g>
			<rect
				x="26"
				y="30"
				width="69"
				height="95"
				rx="5"
				fill="var(--preview-surface)"
				stroke="var(--preview-border)"
			/>
			<g fill="var(--preview-control)">
				<rect x="34" y="39" width="37" height="5" rx="2" />
				<rect x="34" y="53" width="15" height="14" rx="3" />
				<rect x="53" y="53" width="15" height="14" rx="3" />
				<rect x="72" y="53" width="15" height="14" rx="3" />
				<rect x="34" y="78" width="53" height="4" rx="2" />
				<rect x="34" y="94" width="53" height="4" rx="2" />
				<rect x="34" y="110" width="53" height="4" rx="2" />
			</g>
			<g fill="var(--preview-muted)">
				<circle cx="52" cy="80" r="3" />
				<circle cx="73" cy="96" r="3" />
				<circle cx="61" cy="112" r="3" />
			</g>
			<rect
				x="103"
				y="30"
				width="176"
				height="95"
				rx="5"
				fill="var(--preview-surface)"
				stroke="var(--preview-border)"
			/>
			<rect x="114" y="39" width="154" height="70" rx="4" fill="var(--preview-stage)" />
			<rect x="128" y="48" width="126" height="52" rx="3" fill="var(--preview-surface)" />
			<rect x="137" y="56" width="30" height="36" rx="2" fill="var(--preview-control)" />
			<rect x="175" y="56" width="70" height="23" rx="2" fill="var(--preview-control)" />
			<path
				d="M175 86H223M175 92H235"
				stroke="var(--preview-muted)"
				strokeWidth="3"
				strokeLinecap="round"
			/>
			<rect x="170" y="115" width="42" height="4" rx="2" fill="var(--preview-muted)" />
			<path d="M8 132H280" stroke="var(--preview-border)" />
			<g fill="var(--preview-track)">
				<rect x="26" y="138" width="72" height="6" rx="2" />
				<rect x="102" y="138" width="104" height="6" rx="2" />
				<rect x="210" y="138" width="63" height="6" rx="2" />
			</g>
			<rect x="26" y="148" width="119" height="4" rx="2" fill="var(--preview-muted)" />
		</svg>
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
