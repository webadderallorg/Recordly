import { Label, Tag, TagGroup } from "@heroui/react";
import type { ReactNode } from "react";
import { PlusBadge } from "@/components/billing/PlusBadge";
export function ExportChoices<T extends string | number>({
	label,
	value,
	options,
	onChange,
	columns,
	headingAction,
}: {
	label: string;
	value: T;
	options: {
		value: T;
		label: ReactNode;
		textValue?: string;
		description?: string;
		plus?: boolean;
	}[];
	onChange?: (value: T) => void;
	columns?: number;
	headingAction?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<Label>{label}</Label>
				{headingAction}
			</div>
			<TagGroup
				aria-label={label}
				selectionMode="single"
				disallowEmptySelection
				selectedKeys={[String(value)]}
				onSelectionChange={(keys) => {
					if (keys === "all") return;
					const selected = options.find((option) => keys.has(String(option.value)));
					if (selected) onChange?.(selected.value);
				}}
				size="lg"
			>
				<TagGroup.List
					className="grid w-full gap-2"
					style={{
						gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))`,
					}}
				>
					{options.map((option) => (
						<Tag
							key={option.value}
							id={String(option.value)}
							textValue={
								option.textValue ??
								(typeof option.label === "string"
									? option.label
									: String(option.value))
							}
							className="h-auto min-h-10 w-full min-w-0 justify-center py-2 text-center [&>[role=gridcell]]:w-full"
						>
							<span className="flex w-full flex-col items-center justify-center gap-0.5 text-center">
								<span className="flex items-center justify-center gap-1.5">
									{option.label}
									{option.plus && <PlusBadge />}
								</span>
								{option.description && (
									<span className="whitespace-nowrap text-xs tabular-nums opacity-70">
										{option.description}
									</span>
								)}
							</span>
						</Tag>
					))}
				</TagGroup.List>
			</TagGroup>
		</div>
	);
}
