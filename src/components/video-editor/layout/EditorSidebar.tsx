import {
	Camera,
	ClosedCaptioning,
	Cursor,
	Gear,
	PuzzlePiece,
	Sparkle,
	UserCircle,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import { toast } from "sonner";
import type { useI18n } from "@/contexts/I18nContext";
import ExtensionManager from "../ExtensionManager";
import { SettingsPanel } from "../SettingsPanel";
import type { EditorEffectSection } from "../types";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	activeSection: EditorEffectSection;
	setActiveSection: Dispatch<SetStateAction<EditorEffectSection>>;
	settingsPanelProps: ComponentProps<typeof SettingsPanel>;
};

export function EditorSidebar({ t, activeSection, setActiveSection, settingsPanelProps }: Props) {
	const sections = useMemo(
		() => [
			{ id: "scene" as const, label: t("settings.sections.scene", "Scene"), icon: Sparkle },
			{ id: "cursor" as const, label: t("settings.sections.cursor", "Cursor"), icon: Cursor },
			{ id: "webcam" as const, label: t("settings.sections.webcam", "Webcam"), icon: Camera },
			{
				id: "captions" as const,
				label: t("settings.sections.captions", "Captions"),
				icon: ClosedCaptioning,
			},
			{
				id: "settings" as const,
				label: t("settings.sections.settings", "Settings"),
				icon: Gear,
			},
			{
				id: "extensions" as const,
				label: t("settings.sections.extensions", "Extensions"),
				icon: PuzzlePiece,
			},
		],
		[t],
	);
	return (
		<div className="flex flex-shrink-0 h-full relative bg-card rounded-xl shadow-xl p-1.5">
			<div className="flex flex-shrink-0 flex-col items-center gap-1 py-2 w-[56px] bg-black/20 rounded-l-xl relative z-20">
				{sections.map((section, index) => {
					const isActive = activeSection === section.id;
					return (
						<div key={section.id} className="relative w-full flex items-center justify-center h-11">
							{isActive ? (
								<motion.div
									layoutId="rail-active-bg"
									className="absolute inset-y-0 right-0 left-2 rounded-l-xl bg-editor-panel z-0"
									transition={{ type: "spring", stiffness: 450, damping: 35 }}
								>
									{/* Top Inverted Curve */}
									{index !== 0 && (
										<svg
											className="absolute -top-4 right-0 h-4 w-4 text-editor-panel pointer-events-none"
											viewBox="0 0 16 16"
											fill="currentColor"
										>
											<path d="M 0 16 A 16 16 0 0 0 16 0 L 16 16 Z" />
										</svg>
									)}
									{/* Bottom Inverted Curve */}
									{index !== sections.length - 1 && (
										<svg
											className="absolute -bottom-4 right-0 h-4 w-4 text-editor-panel pointer-events-none"
											viewBox="0 0 16 16"
											fill="currentColor"
										>
											<path d="M 0 0 A 16 16 0 0 1 16 16 L 16 0 Z" />
										</svg>
									)}
								</motion.div>
							) : null}
							
							<button
								type="button"
								onClick={() => setActiveSection(section.id)}
								title={section.label}
								className="group relative z-10 flex h-9 w-9 items-center justify-center rounded-lg outline-none focus:outline-none focus-visible:outline-none transition-colors"
							>
								<motion.span
									className="relative z-10"
									animate={{
										color: isActive ? "hsl(var(--primary))" : "hsl(var(--foreground))",
										opacity: isActive ? 1 : 0.55,
									}}
									whileHover={{ opacity: 1 }}
									transition={{ duration: 0.14 }}
								>
									<section.icon
										className="h-[24px] w-[24px]"
										weight={isActive ? "fill" : "regular"}
									/>
								</motion.span>
							</button>
						</div>
					);
				})}
				<div className="mt-auto relative w-full flex items-center justify-center pt-3 z-20">
					<button
						type="button"
						onClick={() =>
							toast.info(t("editor.account.comingSoon", "Account coming soon"))
						}
						title={t("editor.account.title", "Account")}
						className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-foreground/55 outline-none transition hover:text-foreground focus:outline-none focus-visible:outline-none"
					>
						<span className="absolute inset-0 rounded-lg bg-foreground/[0.04] opacity-0 transition group-hover:opacity-100" />
						<UserCircle className="relative z-10 h-[24px] w-[24px]" />
					</button>
				</div>
			</div>
			{activeSection === "extensions" ? (
				<ExtensionManager />
			) : (
				<SettingsPanel {...settingsPanelProps} />
			)}
		</div>
	);
}
