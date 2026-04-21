"use client";

import * as React from "react";
import {
	DirectionProvider as DirectionProviderPrimitive,
	useDirection,
} from "@radix-ui/react-direction";

function DirectionProvider({
	dir,
	direction,
	children,
}: React.ComponentProps<typeof DirectionProviderPrimitive> & {
	direction?: React.ComponentProps<typeof DirectionProviderPrimitive>["dir"];
}) {
	return (
		<DirectionProviderPrimitive dir={direction ?? dir}>{children}</DirectionProviderPrimitive>
	);
}

export { DirectionProvider, useDirection };
