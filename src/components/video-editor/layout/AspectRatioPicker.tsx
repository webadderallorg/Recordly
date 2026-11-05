import {
	Form,
	Input,
	Label,
	Popover,
	Radio,
	RadioGroup,
	Separator,
	TextField,
} from "@heroui/react";
import { Layout } from "@phosphor-icons/react";
import { useState } from "react";
import { FaYoutube } from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { CaretDown } from "@/components/ui/icons";
import { useI18n } from "@/contexts/I18nContext";
import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import instagram from "@/assets/aspect-ratio/instagram.png";
import twitter from "@/assets/aspect-ratio/twitter.png";
import "./AspectRatioPicker.css";

// Frame picker structure, ratios and platform groups from https://shots.so/.
// Layout ported from its delivered de3248a8ef4a1ba5.css stylesheet; interaction
// primitives are HeroUI. Platform artwork is bundled locally for offline use.
const RATIOS = ["16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"] as const;
const PLATFORMS = [
	{
		name: "Twitter",
		icon: twitter,
		presets: [
			["Tweet", "16:9"],
			["Cover", "3:1"],
		],
	},
	{
		name: "YouTube",
		presets: [
			["Banner", "16:9"],
			["Thumbnail", "16:9"],
			["Video", "16:9"],
		],
	},
	{
		name: "Instagram",
		icon: instagram,
		presets: [
			["Post", "1:1"],
			["Portrait", "4:5"],
			["Story", "9:16"],
		],
	},
] as const;

type Props = {
	value: AspectRatio;
	onChange: (value: AspectRatio) => void;
	sourceWidth?: number;
	sourceHeight?: number;
};

export function AspectRatioPicker({
	value,
	onChange,
	sourceWidth = 1920,
	sourceHeight = 1080,
}: Props) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const [width, setWidth] = useState("");
	const [height, setHeight] = useState("");
	const [selection, setSelection] = useState<{ key: string; ratio: AspectRatio } | null>(null);
	const autoLabel = t("editing.auto", "Auto");
	const label = value === "native" ? autoLabel : value;
	const safeSourceWidth = sourceWidth > 0 ? sourceWidth : 1920;
	const safeSourceHeight = sourceHeight > 0 ? sourceHeight : 1080;
	const ratio = getAspectRatioValue(value, safeSourceWidth / safeSourceHeight);
	const longSide = Math.max(safeSourceWidth, safeSourceHeight);
	const currentWidth =
		value === "native" ? safeSourceWidth : Math.round(longSide * Math.min(1, ratio));
	const currentHeight =
		value === "native" ? safeSourceHeight : Math.round(longSide / Math.max(1, ratio));
	const selected = selection?.ratio === value ? selection.key : `ratio/${value}`;

	function choose(next: AspectRatio, key: string) {
		setSelection({ ratio: next, key });
		onChange(next);
		if (key !== "custom") {
			const nextRatio = getAspectRatioValue(next, safeSourceWidth / safeSourceHeight);
			setWidth(
				String(
					next === "native"
						? safeSourceWidth
						: Math.round(longSide * Math.min(1, nextRatio)),
				),
			);
			setHeight(
				String(
					next === "native"
						? safeSourceHeight
						: Math.round(longSide / Math.max(1, nextRatio)),
				),
			);
		}
	}

	function applySize(nextWidth: string, nextHeight: string) {
		if (
			[nextWidth, nextHeight].every(
				(text) => /^\d+$/.test(text) && Number(text) >= 128 && Number(text) <= 7680,
			)
		)
			choose(`${Number(nextWidth)}:${Number(nextHeight)}`, "custom");
	}

	function platformIcon(platform: (typeof PLATFORMS)[number]) {
		return "icon" in platform ? (
			<img src={platform.icon} alt="" draggable={false} />
		) : (
			<FaYoutube aria-hidden="true" className="aspect-ratio-picker__youtube" />
		);
	}

	function option(
		next: AspectRatio,
		key: string,
		name?: string,
		platform?: (typeof PLATFORMS)[number],
	) {
		const numeric = getAspectRatioValue(next, safeSourceWidth / safeSourceHeight);
		return (
			<Radio key={key} value={key} className="aspect-ratio-picker__option">
				<Radio.Content
					className={`aspect-ratio-picker__item ${numeric < 1 ? "is-portrait" : "is-landscape"}`}
				>
					<span className="aspect-ratio-picker__icon-wrapper" aria-hidden="true">
						<span className="aspect-ratio-picker__icon-display">
							<span
								className="aspect-ratio-picker__shape"
								style={{
									aspectRatio: numeric,
									borderStyle: next === "native" ? "dashed" : undefined,
								}}
							>
								{platform && platformIcon(platform)}
							</span>
						</span>
					</span>
					<Label className="aspect-ratio-picker__details">
						{name && <span className="aspect-ratio-picker__name">{name}</span>}
						<span className="aspect-ratio-picker__ratio">
							{next === "native" ? autoLabel : next}
						</span>
					</Label>
				</Radio.Content>
			</Radio>
		);
	}

	return (
		<Popover
			isOpen={open}
			onOpenChange={(next) => {
				if (next) {
					const dimensions = value.split(":");
					const customSize =
						dimensions.length === 2 &&
						dimensions.every((text) => Number(text) >= 128 && Number(text) <= 7680);
					setWidth(customSize ? dimensions[0] : String(currentWidth));
					setHeight(customSize ? dimensions[1] : String(currentHeight));
				}
				setOpen(next);
			}}
		>
			<Button
				variant="ghost"
				size="sm"
				className="h-7 gap-1.5 px-2 text-xs"
				aria-label={`${t("editor.aspectRatio.title", "Aspect ratio")}: ${label}`}
			>
				<Layout className="size-4 shrink-0" aria-hidden="true" />
				<span className="font-medium">{label}</span>
				<CaretDown className="size-3" />
			</Button>
			<Popover.Content placement="bottom" offset={6} className="aspect-ratio-picker">
				<Popover.Dialog
					aria-label={t("editor.aspectRatio.title", "Aspect ratio")}
					className="aspect-ratio-picker__dialog"
				>
					<div
						className="aspect-ratio-picker__body"
						onKeyDownCapture={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								setOpen(false);
							}
						}}
					>
						<Form
							className="aspect-ratio-picker__custom"
							onSubmit={(event) => {
								event.preventDefault();
							}}
						>
							<TextField className="aspect-ratio-picker__field">
								<Label>
									<span aria-hidden="true">W</span>
									<span className="sr-only">{t("common.width", "Width")}</span>
								</Label>
								<Input
									aria-label={t("common.width", "Width")}
									type="number"
									min={128}
									max={7680}
									step={1}
									placeholder={String(currentWidth)}
									value={width}
									onChange={(event) => {
										setWidth(event.target.value);
										applySize(event.target.value, height);
									}}
								/>
							</TextField>
							<TextField className="aspect-ratio-picker__field">
								<Label>
									<span aria-hidden="true">H</span>
									<span className="sr-only">{t("common.height", "Height")}</span>
								</Label>
								<Input
									aria-label={t("common.height", "Height")}
									type="number"
									min={128}
									max={7680}
									step={1}
									placeholder={String(currentHeight)}
									value={height}
									onChange={(event) => {
										setHeight(event.target.value);
										applySize(width, event.target.value);
									}}
								/>
							</TextField>
						</Form>
						<Separator className="aspect-ratio-picker__divider" />
						<RadioGroup
							aria-label={t("editor.aspectRatio.presets", "Aspect ratio presets")}
							value={selected}
							onChange={(key) => {
								const [, group, index] = key.split("/");
								if (key.startsWith("platform/")) {
									const item = PLATFORMS[Number(group)]?.presets[Number(index)];
									if (item) choose(item[1], key);
								} else if (key.startsWith("ratio/"))
									choose(group as AspectRatio, key);
							}}
							className="aspect-ratio-picker__groups"
						>
							<section
								className="aspect-ratio-picker__platform"
								aria-label="Recordly"
							>
								<div className="aspect-ratio-picker__grid">
									{(["native", "16:10", "10:16"] as const).map((next) =>
										option(next, `ratio/${next}`),
									)}
								</div>
							</section>
							<Separator className="aspect-ratio-picker__divider" />
							<section
								className="aspect-ratio-picker__grid"
								aria-label={t("editor.aspectRatio.standard", "Standard ratios")}
							>
								{RATIOS.map((next) => option(next, `ratio/${next}`))}
							</section>
							{PLATFORMS.map((platform, group) => (
								<section
									key={platform.name}
									className="aspect-ratio-picker__platform"
									aria-label={platform.name}
								>
									<Separator className="aspect-ratio-picker__divider" />
									<h3 className="aspect-ratio-picker__heading">
										{platformIcon(platform)}
										{platform.name}
									</h3>
									<div className="aspect-ratio-picker__grid">
										{platform.presets.map(([name, next], index) =>
											option(
												next,
												`platform/${group}/${index}`,
												name,
												platform,
											),
										)}
									</div>
								</section>
							))}
						</RadioGroup>
					</div>
				</Popover.Dialog>
			</Popover.Content>
		</Popover>
	);
}
