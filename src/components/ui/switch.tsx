import { Switch as HeroSwitch } from "@heroui/react";
import { type ComponentProps } from "react";
type SwitchProps = Omit<
	Omit<ComponentProps<typeof HeroSwitch>, "children"> & { children?: import("react").ReactNode },
	"onChange"
> & {
	checked?: boolean;
	defaultChecked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
	disabled?: boolean;
};
export function Switch({
	checked,
	defaultChecked,
	onCheckedChange,
	disabled,
	children,
	...props
}: SwitchProps) {
	return (
		<HeroSwitch
			{...props}
			isSelected={checked}
			defaultSelected={defaultChecked}
			onChange={onCheckedChange}
			isDisabled={disabled}
		>
			<HeroSwitch.Content>
				<HeroSwitch.Control>
					<HeroSwitch.Thumb />
				</HeroSwitch.Control>
				{children}
			</HeroSwitch.Content>
		</HeroSwitch>
	);
}
