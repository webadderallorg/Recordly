import { Tabs as HeroTabs } from "@heroui/react";
import { type ComponentProps } from "react";
type TabsProps = Omit<ComponentProps<typeof HeroTabs>, "onSelectionChange"> & {
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
};
export function Tabs({ value, defaultValue, onValueChange, ...props }: TabsProps) {
	return (
		<HeroTabs
			{...props}
			selectedKey={value}
			defaultSelectedKey={defaultValue}
			onSelectionChange={(key) => onValueChange?.(String(key))}
		/>
	);
}
export function TabsList(props: ComponentProps<typeof HeroTabs.List>) {
	return (
		<HeroTabs.ListContainer>
			<HeroTabs.List {...props} />
		</HeroTabs.ListContainer>
	);
}
export function TabsTrigger({
	value,
	disabled,
	children,
	...props
}: Omit<
	Omit<ComponentProps<typeof HeroTabs.Tab>, "children"> & {
		children?: import("react").ReactNode;
	},
	"id"
> & { value: string; disabled?: boolean }) {
	return (
		<HeroTabs.Tab {...props} id={value} isDisabled={disabled}>
			{children}
			<HeroTabs.Indicator />
		</HeroTabs.Tab>
	);
}
export function TabsContent({
	value,
	...props
}: Omit<ComponentProps<typeof HeroTabs.Panel>, "id"> & { value: string }) {
	return <HeroTabs.Panel {...props} id={value} />;
}
