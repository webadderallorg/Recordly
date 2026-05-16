import { Canvas } from "@react-three/fiber";
import { Environment, PerspectiveCamera } from "@react-three/drei";
import { EffectComposer, DepthOfField, Bloom, Vignette } from "@react-three/postprocessing";
import { Suspense, Fragment } from "react";
import { CameraRig } from "./CameraRig";
import { DeviceMesh } from "./DeviceMesh";
import type { FlatValues } from "@/hooks/engine/useAnimationTimeline";
import type * as THREE from "three";

export type HdriPreset =
	| "apartment"
	| "city"
	| "dawn"
	| "forest"
	| "lobby"
	| "night"
	| "park"
	| "studio"
	| "sunset"
	| "warehouse";

interface MockupSceneProps {
	cameraValues: FlatValues;
	deviceValues: FlatValues;
	screenTexture: THREE.VideoTexture | null;
	deviceType: "phone" | "laptop" | "tablet";
	hdri: HdriPreset;
	background: string | null;
	depthOfField: boolean;
	bloom: boolean;
}

export function MockupScene({
	cameraValues,
	deviceValues,
	screenTexture,
	deviceType,
	hdri,
	background,
	depthOfField,
	bloom,
}: MockupSceneProps) {
	return (
		<Canvas
			gl={{ antialias: true, preserveDrawingBuffer: true }}
			dpr={[1, 2]}
			style={{ width: "100%", height: "100%" }}
		>
			{/* Camera at default position — CameraRig overrides via lerp */}
			<PerspectiveCamera makeDefault position={[0, 0, 5]} fov={45} />

			<Suspense fallback={null}>
				{/* HDRI environment lighting */}
				<Environment
					preset={hdri}
					background={background === null}
					backgroundBlurriness={0.6}
					backgroundIntensity={0.4}
				/>

				{/* Solid or gradient background override */}
				{background ? <color attach="background" args={[background]} /> : null}

				<CameraRig values={cameraValues} />

				<DeviceMesh
					values={deviceValues}
					screenTexture={screenTexture}
					deviceType={deviceType}
				/>
			</Suspense>

			{/* Post-processing */}
			<EffectComposer>
				<Fragment>
					{depthOfField ? (
						<DepthOfField focusDistance={0} focalLength={0.04} bokehScale={2} />
					) : null}
					{bloom ? (
						<Bloom intensity={0.3} luminanceThreshold={0.9} luminanceSmoothing={0.9} />
					) : null}
					<Vignette eskil={false} offset={0.1} darkness={0.6} />
				</Fragment>
			</EffectComposer>
		</Canvas>
	);
}
