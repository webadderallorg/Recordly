import { Alert, Button, Card, Link, Toast, toast } from "@heroui/react";
import { LinkSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function Brand() {
	return (
		<Link
			href="https://github.com/webadderallorg/Recordly"
			target="_blank"
			rel="noopener noreferrer"
			className="brand"
		>
			<img src="/icon-64.png" alt="" width="28" height="28" />
			<span>Recordly</span>
		</Link>
	);
}

export function Notice({ children }: { children: ReactNode }) {
	return (
		<Alert status="danger" role="alert">
			<Alert.Indicator>
				<WarningCircleIcon />
			</Alert.Indicator>
			<Alert.Content>
				<Alert.Description>{children}</Alert.Description>
			</Alert.Content>
		</Alert>
	);
}

export function CenteredCard({ children }: { children: ReactNode }) {
	return (
		<main className="gate-page">
			<Card className="gate-card">
				<Card.Header>
					<Brand />
				</Card.Header>
				<Card.Content className="gate-content">{children}</Card.Content>
			</Card>
		</main>
	);
}

export async function copyLink(time = 0, code?: string) {
	const url = new URL(code ? `/s/${code}` : window.location.pathname, window.location.origin);
	if (time > 0) url.searchParams.set("t", String(Math.floor(time)));
	try {
		await navigator.clipboard.writeText(url.href);
		toast.success("Link copied");
	} catch {
		toast.danger("Could not copy the link. Copy the address from your browser.");
	}
}

export function CopyButton({ time = 0, code }: { time?: number; code?: string }) {
	return (
		<Button size="sm" variant="secondary" onPress={() => void copyLink(time, code)}>
			<LinkSimpleIcon size={16} />
			Copy link
		</Button>
	);
}

export function Notifications() {
	return <Toast.Provider placement="bottom" />;
}
