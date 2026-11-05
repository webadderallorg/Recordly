import { Button, Description, Modal } from "@heroui/react";
import { ArrowRight } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { RecordlyDemoVideo } from "@/components/ui/RecordlyDemoVideo";
import { useScopedT } from "@/contexts/I18nContext";
import "./Onboarding.css";

type OnboardingStage = "account" | "permissions";

export function OnboardingLayout({
	stage,
	onStageChange,
	canViewPermissions,
	showNavigation = true,
	footer,
	children,
}: {
	stage: OnboardingStage;
	onStageChange?: (stage: OnboardingStage) => void;
	canViewPermissions: boolean;
	showNavigation?: boolean;
	footer?: ReactNode;
	children: ReactNode;
}) {
	const t = useScopedT("onboarding");
	const stages = [
		{ key: "account", label: t("account") },
		{ key: "permissions", label: t("permissions") },
	] as const;
	const reduceMotion = useReducedMotion();
	const transition = { duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] as const };
	return (
		<div
			data-onboarding-stage={stage}
			data-onboarding-carousel={onStageChange ? "true" : undefined}
			className="onboarding-layout flex h-full min-h-0 flex-col"
		>
			<div className="onboarding-ambience" aria-hidden="true">
				<span className="onboarding-blob onboarding-blob-one" />
				<span className="onboarding-blob onboarding-blob-two" />
				<span className="onboarding-blob onboarding-blob-three" />
			</div>
			<motion.div
				data-onboarding-artwork
				layout={reduceMotion || onStageChange ? false : "size"}
				layoutDependency={stage}
				transition={transition}
				className="onboarding-artwork relative m-2 overflow-hidden rounded-t-2xl"
			>
				<RecordlyDemoVideo className="absolute inset-0" />
			</motion.div>
			<motion.div
				layout={reduceMotion || onStageChange ? false : "position"}
				layoutDependency={stage}
				transition={transition}
				className={`onboarding-stage-content grid min-h-0 ${stage === "account" ? "shrink-0" : "shrink overflow-hidden"}`}
			>
				{children}
			</motion.div>
			{onStageChange ? (
				<div className="onboarding-carousel-footer flex shrink-0 flex-col justify-end">
					{footer}
				</div>
			) : footer}
			{showNavigation && (
				<nav
					aria-label={t("pages")}
					className="onboarding-navigation flex shrink-0 justify-center gap-1 px-6 pb-4 pt-2"
				>
					{stages.map(({ key, label }) => (
						<button
							key={key}
							type="button"
							aria-label={label}
							aria-current={stage === key ? "page" : undefined}
							disabled={key === "permissions" && !canViewPermissions}
							onClick={() => onStageChange?.(key)}
							className="group flex size-8 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<span
								aria-hidden="true"
								className={`h-2 rounded-full transition-[width,background-color] motion-reduce:transition-none ${stage === key ? "w-6 bg-accent" : "w-2 bg-foreground/25 group-hover:bg-foreground/45"}`}
							/>
						</button>
					))}
				</nav>
			)}
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
			className={`onboarding-body ${scrollable ? "min-h-0 flex-1 overflow-y-auto" : "shrink-0"}`}
		>
			<div className="onboarding-body-content mx-auto w-full max-w-[560px] space-y-6">{children}</div>
		</div>
	);
}

export function OnboardingHeader({
	title,
	description,
	centered = false,
}: {
	title: ReactNode;
	description?: string;
	centered?: boolean;
}) {
	const reduceMotion = useReducedMotion();
	return (
		<motion.div
			initial={reduceMotion ? false : { opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: reduceMotion ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
		>
			<Modal.Header
				className={`onboarding-header p-0 ${centered ? "items-center text-center" : "items-start text-left"}`}
			>
				<Modal.Heading className="heading-display">{title}</Modal.Heading>
				{description && (
					<Description className="text-sm leading-relaxed">{description}</Description>
				)}
			</Modal.Header>
		</motion.div>
	);
}

function OnboardingTitleLogo() {
	return (
		<span
			aria-hidden="true"
			className="onboarding-title-logo"
			style={{
				maskImage: `url(${import.meta.env.BASE_URL}app-icons/recordly-mark.svg)`,
				WebkitMaskImage: `url(${import.meta.env.BASE_URL}app-icons/recordly-mark.svg)`,
			}}
		/>
	);
}

export function OnboardingTitleBrand() {
	return (
		<span
			data-onboarding-title-brand
			className="inline-flex items-center gap-2 whitespace-nowrap align-bottom"
		>
			<OnboardingTitleLogo />
			Recordly
		</span>
	);
}

export function OnboardingHeroTitle({ text }: { text: string }) {
	return (
		<span className="recordly-signin-hero">
			<OnboardingTitle text={text} />
		</span>
	);
}

/** Keep the wordmark while allowing each language to place the product name. */
export function OnboardingTitle({ text }: { text: string }) {
	const parts = text.split("{{brand}}");
	return (
		<>
			{parts[0]}
			<OnboardingTitleBrand />
			{parts[1]}
		</>
	);
}

export function OnboardingFooter({ children }: { children: ReactNode }) {
	return (
		<div className="shrink-0">
			<Modal.Footer className="onboarding-footer mt-0">
				<div className="mx-auto flex w-full max-w-[560px] items-end justify-between gap-3 [&_.button]:h-11 [&_.button]:rounded-xl">
					{children}
				</div>
			</Modal.Footer>
		</div>
	);
}

export function OnboardingPrimaryAction({
	children,
	isDisabled,
	onPress,
}: {
	children: ReactNode;
	isDisabled: boolean;
	onPress: () => void;
}) {
	const reduceMotion = useReducedMotion();
	// HeroUI mounts render-prop content after the surrounding footer.
	const [label, setLabel] = useState<HTMLSpanElement | null>(null);
	const [width, setWidth] = useState<number>();
	useLayoutEffect(() => {
		const button = label?.closest("button");
		if (!button || !label) return;
		const measure = () => {
			const style = getComputedStyle(button);
			setWidth(Math.ceil(
				label.offsetWidth +
				Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight) +
				Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth),
			));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(label);
		return () => observer.disconnect();
	}, [label]);
	return (
		<div
			style={{
				width,
				transition: reduceMotion ? "none" : "width 280ms cubic-bezier(0.22, 1, 0.36, 1)",
			}}
			className="min-w-0 shrink-0"
		>
			<Button
				data-onboarding-primary-action
				variant="primary"
				isDisabled={isDisabled}
				onPress={onPress}
				style={{ width: "100%", overflow: "hidden" }}
			>
				<span ref={setLabel} className="flex w-max shrink-0 items-center gap-2 whitespace-nowrap">
					{children} <ArrowRight size={16} aria-hidden="true" />
				</span>
			</Button>
		</div>
	);
}
