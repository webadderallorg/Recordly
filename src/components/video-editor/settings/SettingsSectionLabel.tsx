import { Label } from "@heroui/react";

export function SectionLabel({ children }: { children: React.ReactNode }) {
	return <Label className="text-[13px]">{children}</Label>;
}
