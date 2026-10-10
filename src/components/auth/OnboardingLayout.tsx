import type { ReactNode } from "react";
import { Description, Modal } from "@heroui/react";
import { motion, useReducedMotion } from "motion/react";
import "./Onboarding.css";

type OnboardingStage = "account" | "permissions";

const stages = [
	{ key: "account", label: "Account" },
	{ key: "permissions", label: "Permissions" },
] as const;

export function OnboardingLayout({
	stage,
	onStageChange,
	canViewPermissions,
	children,
}: {
	stage: OnboardingStage;
	onStageChange: (stage: OnboardingStage) => void;
	canViewPermissions: boolean;
	children: ReactNode;
}) {
	const reduceMotion = useReducedMotion();
	const transition = { duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] as const };
	return (
		<div className="flex h-full min-h-0 flex-col">
			<motion.div
				data-onboarding-artwork
				layout={reduceMotion ? false : "size"}
				layoutDependency={stage}
				transition={transition}
				className="relative m-2 mb-0 min-h-24 flex-1 overflow-hidden rounded-2xl sm:min-h-32"
			>
				<img
					src={`${import.meta.env.BASE_URL}auth/login-banner.png`}
					alt=""
					className="absolute inset-0 size-full object-cover object-center"
				/>
			</motion.div>
			<motion.div
				layout={reduceMotion ? false : "position"}
				layoutDependency={stage}
				transition={transition}
				className="flex min-h-0 shrink flex-col overflow-hidden"
			>
				{children}
			</motion.div>
			<nav
				aria-label="Onboarding pages"
				className="flex shrink-0 justify-center gap-1 px-6 pb-4 pt-2"
			>
				{stages.map(({ key, label }) => (
					<button
						key={key}
						type="button"
						aria-label={label}
						aria-current={stage === key ? "page" : undefined}
						disabled={key === "permissions" && !canViewPermissions}
						onClick={() => onStageChange(key)}
						className="group flex size-8 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
					>
						<span
							aria-hidden="true"
							className={`h-2 rounded-full transition-[width,background-color] motion-reduce:transition-none ${stage === key ? "w-6 bg-accent" : "w-2 bg-foreground/25 group-hover:bg-foreground/45"}`}
						/>
					</button>
				))}
			</nav>
		</div>
	);
}

export function OnboardingBody({
	children,
	scrollable = true,
}: {
	children: ReactNode;
	scrollable?: boolean;
}) {
	return (
		<div
			data-onboarding-body
			className={`px-6 py-7 sm:px-10 sm:py-8 ${scrollable ? "min-h-0 flex-1 overflow-y-auto" : "shrink-0"}`}
		>
			<div className="mx-auto w-full max-w-[560px] space-y-6">{children}</div>
		</div>
	);
}

export function OnboardingHeader({ title, description }: { title: string; description: string }) {
	return (
		<Modal.Header className="items-start gap-2 p-0 text-left">
			<div
				data-onboarding-brand
				className="mb-3 flex items-center gap-2.5"
				aria-label="Recordly"
			>
				<img
					src={`${import.meta.env.BASE_URL}app-icons/recordly-128.png`}
					alt=""
					className="size-10 rounded-xl"
				/>
				<span className="text-lg font-semibold tracking-tight">Recordly</span>
			</div>
			<Modal.Heading className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
				{title}
			</Modal.Heading>
			<Description className="text-sm leading-relaxed">{description}</Description>
		</Modal.Header>
	);
}

export function OnboardingFooter({ children }: { children: ReactNode }) {
	return (
		<Modal.Footer className="mt-0 shrink-0 px-6 pb-2 pt-3 sm:px-10">
			<div className="mx-auto flex w-full max-w-[560px] items-center justify-between gap-3 [&_.button]:h-11 [&_.button]:rounded-xl">
				{children}
			</div>
		</Modal.Footer>
	);
}
