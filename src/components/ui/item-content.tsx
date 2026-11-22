import type { PropsWithChildren } from "react";
import { Card } from "@/components/ui/card";

interface ItemContentProps extends PropsWithChildren {
	classes: string;
}

function ItemContent({ children, classes }: ItemContentProps) {
	return (
		<Card
			className={`w-full flex flex-row items-center px-3 py-1 gap-2 ${classes}`}
			style={{ minHeight: 40 }}
		>
			{children}
		</Card>
	);
}

export default ItemContent;
