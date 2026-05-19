import { memo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { type ExtensionSettingField, extensionHost } from "@/lib/extensions";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/select";
import { SliderControl } from "../../SliderControl";

function getStepPrecision(step: number): number {
	if (!Number.isFinite(step) || step <= 0) return 0;
	const [mantissa = "0", exponentPart = "0"] = step.toExponential().split("e");
	const exponent = Number.parseInt(exponentPart, 10);
	const mantissaDecimals = (mantissa.split(".")[1] ?? "").replace(/0+$/, "").length;
	const precision = exponent < 0 ? Math.max(0, -exponent + mantissaDecimals) : mantissaDecimals;
	return Math.min(12, precision);
}

export type SettingsPanelExtension = ReturnType<typeof extensionHost.getSettingsPanels>[number];

export const ExtensionSettingsSection = memo(({
	extensionId,
	label,
	fields,
	isInitialLoading = false,
}: {
	extensionId: string;
	label: string;
	fields: ExtensionSettingField[];
	isInitialLoading?: boolean;
}) => {
	const [, forceUpdate] = useState(0);

	if (isInitialLoading) {
		return (
			<div className="flex flex-col gap-3 mt-2 pt-2 border-t border-foreground/[0.06]">
				<Skeleton className="h-3 w-20 mb-1" variant="subtle" />
				<Skeleton className="h-8 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
				<Skeleton className="h-8 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-foreground/[0.06]">
			<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
				{label}
			</p>
			{fields.map((field) => {
				const value =
					extensionHost.getExtensionSetting(extensionId, field.id) ?? field.defaultValue;

				if (field.type === "toggle") {
					return (
						<div
							key={field.id}
							className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5"
						>
							<span className="text-[11px] text-muted-foreground">{field.label}</span>
							<Switch
								checked={Boolean(value)}
								onCheckedChange={(checked) => {
									extensionHost.setExtensionSetting(
										extensionId,
										field.id,
										checked,
									);
									forceUpdate((n) => n + 1);
								}}
								className="data-[state=checked]:bg-[#2563EB] scale-75"
							/>
						</div>
					);
				}

				if (field.type === "slider") {
					const step = field.step ?? 0.01;
					const precision = getStepPrecision(step);
					
					return (
						<div key={field.id} className="mt-1">
							<SliderControl
								label={field.label}
								value={
									typeof value === "number"
										? value
										: (field.defaultValue as number)
								}
								defaultValue={field.defaultValue as number}
								min={field.min ?? 0}
								max={field.max ?? 1}
								step={step}
								onChange={(v) => {
									extensionHost.setExtensionSetting(extensionId, field.id, v);
									forceUpdate((n) => n + 1);
								}}
								formatValue={(v) => v.toFixed(precision)}
								parseInput={(text) => parseFloat(text)}
							/>
						</div>
					);
				}

				if (field.type === "select" && field.options) {
					return (
						<div
							key={field.id}
							className="flex items-center justify-between gap-2 rounded-lg bg-foreground/[0.03] px-2.5 py-1.5"
						>
							<span className="text-[11px] text-muted-foreground flex-shrink-0">
								{field.label}
							</span>
							<Select
								value={String(value)}
								onValueChange={(v) => {
									extensionHost.setExtensionSetting(extensionId, field.id, v);
									forceUpdate((n) => n + 1);
								}}
							>
								<SelectTrigger className="h-6 w-24 text-[10px] border-foreground/10 bg-foreground/[0.03]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{field.options.map((opt) => (
										<SelectItem
											key={opt.value}
											value={opt.value}
											className="text-[10px]"
										>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					);
				}

				if (field.type === "color") {
					return (
						<div
							key={field.id}
							className="flex items-center justify-between gap-2 rounded-lg bg-foreground/[0.03] px-2.5 py-1.5"
						>
							<span className="text-[11px] text-muted-foreground flex-shrink-0">
								{field.label}
							</span>
							<input
								type="color"
								value={String(value)}
								onChange={(e) => {
									extensionHost.setExtensionSetting(
										extensionId,
										field.id,
										e.target.value,
									);
									forceUpdate((n) => n + 1);
								}}
								className="w-7 h-5 rounded border border-foreground/10 cursor-pointer bg-transparent"
							/>
						</div>
					);
				}

				if (field.type === "text") {
					return (
						<div
							key={field.id}
							className="flex items-center justify-between gap-2 rounded-lg bg-foreground/[0.03] px-2.5 py-1.5"
						>
							<span className="text-[11px] text-muted-foreground flex-shrink-0">
								{field.label}
							</span>
							<input
								type="text"
								value={String(value)}
								onChange={(e) => {
									extensionHost.setExtensionSetting(
										extensionId,
										field.id,
										e.target.value,
									);
									forceUpdate((n) => n + 1);
								}}
								className="w-24 h-6 rounded bg-foreground/[0.06] border border-foreground/10 px-1.5 text-[10px] text-foreground"
							/>
						</div>
					);
				}

				return null;
			})}
		</div>
	);
});

ExtensionSettingsSection.displayName = "ExtensionSettingsSection";

export const SettingsExtensionPanels = memo(({
	panels,
	sections,
	isInitialLoading = false,
}: {
	panels: SettingsPanelExtension[];
	sections: string[];
	isInitialLoading?: boolean;
}) => {
	return (
		<>
			{panels
				.filter((panel) => {
					const parentSection = panel.panel.parentSection;
					return parentSection ? sections.includes(parentSection) : false;
				})
				.map((panel) => (
					<ExtensionSettingsSection
						key={`${panel.extensionId}/${panel.panel.id}`}
						extensionId={panel.extensionId}
						label={panel.panel.label}
						fields={panel.panel.fields}
						isInitialLoading={isInitialLoading}
					/>
				))}
		</>
	);
});

SettingsExtensionPanels.displayName = "SettingsExtensionPanels";
