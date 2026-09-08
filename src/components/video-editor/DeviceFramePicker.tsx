import blackFrame from "@/assets/device-frames/iphone-16-pro-black-titanium.png";
import silverFrame from "@/assets/device-frames/iphone-16-pro-white-titanium.png";
import { Check } from "@phosphor-icons/react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import type { DeviceFrame } from "./deviceFrame";

const OPTIONS = ["none", "iphone-black", "iphone-silver"] as const;

export function DeviceFramePicker({
	value,
	onChange,
}: {
	value: DeviceFrame;
	onChange: (value: DeviceFrame) => void;
}) {
	const t = useScopedT("settings");
	return (
		<div className="flex flex-col gap-2 pb-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-muted-foreground">{t("deviceFrame.title")}</span>
				<span className="text-[10px] text-muted-foreground">iPhone 16 Pro</span>
			</div>
			<div
				className="grid grid-cols-3 gap-2"
				role="group"
				aria-label={t("deviceFrame.title")}
			>
				{OPTIONS.map((option) => {
					const selected = value === option;
					const silver = option === "iphone-silver";
					return (
						<button
							key={option}
							type="button"
							aria-label={t(`deviceFrame.${option}.label`)}
							aria-pressed={selected}
							onClick={() => onChange(option)}
							className={cn(
								"relative flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-editor-panel",
								selected
									? "border-[#2563EB] bg-[#2563EB]/10"
									: "border-border/60 bg-foreground/[0.025] hover:border-foreground/25 hover:bg-foreground/5",
							)}
						>
							{selected && (
								<Check
									weight="bold"
									className="absolute right-1.5 top-1.5 h-3 w-3 text-[#2563EB]"
									aria-hidden="true"
								/>
							)}
							<div
								className="flex h-[86px] items-center justify-center"
								aria-hidden="true"
							>
								<div className="relative h-[80px] w-[39px] drop-shadow-sm">
									<div
										className={cn(
											"absolute bg-gradient-to-br from-[#b8caca] via-[#688183] to-[#344954]",
											option === "none"
												? "inset-x-[3px] inset-y-[2px] rounded-[3px]"
												: "left-[5.333%] top-[2.5%] h-[95%] w-[89.333%] rounded-[5px]",
										)}
									/>
									{option !== "none" && (
										<img
											src={silver ? silverFrame : blackFrame}
											alt=""
											className="absolute inset-0 h-full w-full"
											draggable={false}
										/>
									)}
								</div>
							</div>
							<span className="text-[11px] font-medium text-foreground">
								{t(`deviceFrame.${option}.name`)}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
