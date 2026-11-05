// Adapted from Aceternity UI Sticky Scroll Reveal. See ORIGIN.txt and original source.
import React, { useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";

export function StickyScroll({ content }) {
	const [activeCard, setActiveCard] = useState(0);
	const ref = useRef(null);
	const reduceMotion = useReducedMotion();
	const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
	useMotionValueEvent(scrollYProgress, "change", latest => {
		const cardsBreakpoints = content.map((_, index) => index / (content.length - 1));
		const closest = cardsBreakpoints.reduce((acc, breakpoint, index) =>
			Math.abs(latest - breakpoint) < Math.abs(latest - cardsBreakpoints[acc]) ? index : acc, 0);
		setActiveCard(closest);
	});
	if (reduceMotion) return <div ref={ref} className="sticky-story-static">
		{content.map((item, index) => <section className="sticky-story-static-step" key={item.title}>
			<div className="sticky-story-text"><span className="sticky-story-step">0{index + 1} / 0{content.length}</span><h2>{item.title}</h2><p>{item.description}</p></div>
			<div className="sticky-story-static-visual">{item.content}</div>
		</section>)}
	</div>;
	return <div ref={ref} className="sticky-story" style={{ "--story-stages": content.length }} data-active-step={activeCard}>
		<div className="sticky-story-stage">
			<div className="sticky-story-copy">
				{content.map((item, index) => <motion.article key={item.title}
					className="sticky-story-text" aria-hidden={index !== activeCard}
					initial={false} animate={{ opacity: index === activeCard ? 1 : 0, y: reduceMotion ? 0 : index === activeCard ? 0 : 12 }}
					transition={{ duration: reduceMotion ? 0 : .3 }}>
					<span className="sticky-story-step">0{index + 1} / 0{content.length}</span>
					<h2>{item.title}</h2>
					<p>{item.description}</p>
				</motion.article>)}
			</div>
			<div className="sticky-story-frame">
				{content.map((item, index) => <motion.div key={item.title}
					className="sticky-story-visual" aria-hidden={index !== activeCard}
					style={{ pointerEvents: index === activeCard ? "auto" : "none" }}
					initial={false} animate={{ opacity: index === activeCard ? 1 : 0 }}
					transition={{ duration: reduceMotion ? 0 : .35 }}>
					{item.content}
				</motion.div>)}
			</div>
		</div>
	</div>;
}
