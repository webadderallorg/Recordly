import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { getCaptionFontFamily } from "../captionFonts";
import { CAPTION_PRESETS, getCaptionPreset } from "../captionPresets";
import type { AutoCaptionStyle } from "../types";
import { useCaptionFont } from "../useCaptionFont";

export function CaptionStylePicker({
	value,
	onChange,
}: {
	value: AutoCaptionStyle | undefined;
	onChange: (style: AutoCaptionStyle) => void;
}) {
	const te = useScopedT("editing");
	useCaptionFont({ style: "tiktok", fontFamily: "" });
	const selected = getCaptionPreset(value).id;
	return (
		<div
			role="group"
			aria-label={te("captionStyle", "Caption style")}
			className="grid w-full grid-cols-3 items-stretch gap-2"
		>
			{CAPTION_PRESETS.map((preset) => {
				const label = te(`captionStyle.${preset.id}`, preset.label);
				return (
					<Button
						key={preset.id}
						type="button"
						variant="outline"
						aria-label={label}
						aria-pressed={selected === preset.id}
						onClick={() => onChange(preset.id)}
						className={`h-[72px] w-full min-w-0 max-w-full flex-col justify-start gap-1 rounded-xl p-1.5 ${selected === preset.id ? "border-accent bg-accent/5" : "border-border"}`}
					>
						<span
							aria-hidden="true"
							className="flex h-9 w-full shrink-0 items-center justify-center rounded-md bg-[#576379] px-2"
							style={{ containerType: "inline-size" }}
						>
							<span
								style={{
									fontSize: "min(11px, 11cqw)",
									fontFamily: getCaptionFontFamily({
										style: preset.id,
										fontFamily: "",
									}),
									fontWeight: preset.fontWeight,
									lineHeight: 1.4,
									padding: "3px 6px",
									borderRadius: preset.settings.boxRadius / 3,
									background: `rgba(${preset.backgroundRgb ?? "0, 0, 0"}, ${preset.settings.backgroundOpacity})`,
									color: preset.settings.inactiveTextColor,
									WebkitTextStroke: preset.outlineEm
										? `${preset.outlineEm}em #000000`
										: undefined,
									paintOrder: "stroke fill",
								}}
							>
								Make{" "}
								<span
									style={{
										color:
											preset.highlightTextColor ?? preset.settings.textColor,
										background: preset.highlightFill ?? undefined,
										borderRadius: "0.22em",
									}}
								>
									it
								</span>{" "}
								pop
							</span>
						</span>
						<span className="text-[11px] font-medium leading-4">{label}</span>
					</Button>
				);
			})}
		</div>
	);
}
