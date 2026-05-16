import Anthropic from "@anthropic-ai/sdk";

// ─── Tool schemas ─────────────────────────────────────────────────────────────
// These are passed directly to the Anthropic API as tools.
// Claude calls them in sequence to build the animation keyframe-by-keyframe.

const vec3 = {
	type: "object" as const,
	properties: {
		x: { type: "number" as const },
		y: { type: "number" as const },
		z: { type: "number" as const },
	},
	required: ["x", "y", "z"],
};

export const ANIMATION_TOOLS: Anthropic.Tool[] = [
	{
		name: "add_camera_keyframe",
		description: "Add a keyframe to the camera at a specific time in the animation.",
		input_schema: {
			type: "object",
			properties: {
				time: {
					type: "number",
					minimum: 0,
					description: "Position in seconds (0 to duration)",
				},
				position: { ...vec3, description: "Camera world position" },
				lookAt: { ...vec3, description: "Point the camera looks toward" },
				fov: {
					type: "number",
					minimum: 10,
					maximum: 120,
					description: "Field of view in degrees",
				},
				easing: {
					type: "string",
					enum: ["linear", "easeIn", "easeOut", "easeInOut", "hold"],
					description: "Interpolation curve from previous keyframe to this one",
				},
			},
			required: ["time"],
		},
	},
	{
		name: "add_device_keyframe",
		description: "Add a keyframe to the device (phone/laptop) transform at a specific time.",
		input_schema: {
			type: "object",
			properties: {
				time: {
					type: "number",
					minimum: 0,
					description: "Position in seconds (0 to duration)",
				},
				rotation: {
					...vec3,
					description: "Euler rotation in degrees (x=tilt, y=spin, z=roll)",
				},
				position: { ...vec3, description: "Device world position offset from origin" },
				scale: {
					type: "number",
					minimum: 0.01,
					maximum: 3,
					description: "Uniform scale (1 = normal size)",
				},
				easing: {
					type: "string",
					enum: ["linear", "easeIn", "easeOut", "easeInOut", "hold"],
				},
			},
			required: ["time"],
		},
	},
	{
		name: "finalize",
		description:
			"Call when the animation is complete. Signals the end of the generation.",
		input_schema: {
			type: "object",
			properties: {
				summary: {
					type: "string",
					description: "One-sentence description of the animation created",
				},
			},
			required: ["summary"],
		},
	},
];

// ─── Easing map ───────────────────────────────────────────────────────────────
// Theatre.js uses its own easing names. Map Claude's names to Theatre.js values.
const EASING_MAP: Record<string, [number, number, number, number]> = {
	linear: [0, 0, 1, 1],
	easeIn: [0.42, 0, 1, 1],
	easeOut: [0, 0, 0.58, 1],
	easeInOut: [0.42, 0, 0.58, 1],
	hold: [1, 0, 1, 0],
};

// ─── Tool execution ───────────────────────────────────────────────────────────
// Each tool call from Claude is executed here against the Theatre.js sequence.

type ToolInput = Record<string, unknown>;

export function executeTool(
	name: string,
	input: ToolInput,
	onFinalize?: (summary: string) => void,
): string {
	if (name === "add_camera_keyframe") {
		const { time, position, lookAt, fov, easing } = input as {
			time: number;
			position?: { x: number; y: number; z: number };
			lookAt?: { x: number; y: number; z: number };
			fov?: number;
			easing?: string;
		};

		const easingCurve = EASING_MAP[easing ?? "easeInOut"];
		recordKeyframe("camera", time, { position, lookAt, fov }, easingCurve);
		return `Camera keyframe added at ${time}s`;
	}

	if (name === "add_device_keyframe") {
		const { time, rotation, position, scale, easing } = input as {
			time: number;
			rotation?: { x: number; y: number; z: number };
			position?: { x: number; y: number; z: number };
			scale?: number;
			easing?: string;
		};

		const easingCurve = EASING_MAP[easing ?? "easeInOut"];
		recordKeyframe("device", time, { rotation, position, scale }, easingCurve);
		return `Device keyframe added at ${time}s`;
	}

	if (name === "finalize") {
		const { summary } = input as { summary: string };
		onFinalize?.(summary);
		return `Animation finalized: ${summary}`;
	}

	return `Unknown tool: ${name}`;
}

// ─── Keyframe store ───────────────────────────────────────────────────────────
// Core-only Theatre.js doesn't expose a direct "add keyframe at time T" API
// without the Studio. We maintain our own keyframe store and feed it to the
// sequence via Theatre.js's state import mechanism.

export type EasingCurve = [number, number, number, number];

export interface Keyframe {
	time: number;
	value: Record<string, unknown>;
	easing: EasingCurve;
}

export const keyframeStore: {
	camera: Keyframe[];
	device: Keyframe[];
} = {
	camera: [],
	device: [],
};

function recordKeyframe(
	target: "camera" | "device",
	time: number,
	value: Record<string, unknown>,
	easing: EasingCurve,
) {
	const store = keyframeStore[target];
	const existing = store.findIndex((k) => Math.abs(k.time - time) < 0.001);
	const kf: Keyframe = { time, value: { ...value }, easing };

	if (existing >= 0) {
		store[existing] = kf;
	} else {
		store.push(kf);
		store.sort((a, b) => a.time - b.time);
	}
}

// ─── Main generation function ─────────────────────────────────────────────────

export interface GenerateAnimationArgs {
	apiKey: string;
	style: "apple" | "tiktok" | "cinematic" | "minimal";
	duration: number;
	fps: number;
	deviceType: "phone" | "laptop" | "tablet";
	userPrompt?: string;
	onProgress?: (message: string) => void;
	onFinalize?: (summary: string) => void;
}

export async function generateAnimation({
	apiKey,
	style,
	duration,
	fps,
	deviceType,
	userPrompt,
	onProgress,
	onFinalize,
}: GenerateAnimationArgs) {
	const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

	// Clear previous keyframes
	keyframeStore.camera = [];
	keyframeStore.device = [];

	const styleGuide: Record<string, string> = {
		apple:
			"Apple-style: emphasise stillness and one confident move. Long held frames. Slow camera drift. Device rotates once, settles perfectly.",
		tiktok:
			"TikTok-style: punchy fast moves, slight overshoot, bouncy energy. Quick device spins, dynamic camera.",
		cinematic:
			"Cinematic: slow elegant push-in, subtle device tilt revealing the screen. Depth and gravitas.",
		minimal:
			"Minimal: near-static. Only one very small camera move. Device barely moves. Let the content speak.",
	};

	const systemPrompt = `You are an expert motion designer creating 3D camera and device animations for product mockup videos.

The scene contains:
- A Camera starting at position (0, 0, 5) looking at the origin
- A ${deviceType} device at the origin with no rotation
- Duration: ${duration}s at ${fps}fps

Animation principles you must follow:
- Always start AND end on a held frame (no movement in first/last 0.3s)
- Use ease-out for entries, ease-in for exits, ease-in-out for traversals
- Camera moves should be slower than device moves
- Never animate more than 2 properties simultaneously without a pause between them
- The first keyframe (time=0) and last keyframe (time=${duration}) must always be set

Style for this animation: ${styleGuide[style]}

Build the animation by calling tools in sequence. Call finalize() when done.`;

	const userMessage = userPrompt
		? userPrompt
		: `Create a ${style}-style ${duration}s animation for a ${deviceType} mockup.`;

	// Use non-streaming API to simplify tool call collection across turns.
	// For large durations Claude may need multiple turns; this handles agentic loops.
	const messages: Anthropic.MessageParam[] = [
		{ role: "user", content: userMessage },
	];

	while (true) {
		const response = await client.messages.create({
			model: "claude-opus-4-7",
			max_tokens: 4096,
			system: systemPrompt,
			tools: ANIMATION_TOOLS,
			messages,
		});

		// Collect tool calls from this response
		const toolResults: Anthropic.ToolResultBlockParam[] = [];

		for (const block of response.content) {
			if (block.type === "tool_use") {
				onProgress?.(`→ ${block.name}`);
				const result = executeTool(block.name, block.input as ToolInput, onFinalize);
				onProgress?.(result);
				toolResults.push({
					type: "tool_result",
					tool_use_id: block.id,
					content: result,
				});
			}
		}

		// If stop_reason is tool_use, continue the loop with results
		if (response.stop_reason === "tool_use" && toolResults.length > 0) {
			messages.push({ role: "assistant", content: response.content });
			messages.push({ role: "user", content: toolResults });
			continue;
		}

		// end_turn or finalize tool called — done
		break;
	}

	return keyframeStore;
}
