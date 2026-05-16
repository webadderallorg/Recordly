import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import type { FlatValues } from "@/hooks/engine/useAnimationTimeline";

const DEG2RAD = Math.PI / 180;

interface DeviceMeshProps {
	values: FlatValues;
	screenTexture: THREE.VideoTexture | null;
	deviceType: "phone" | "laptop" | "tablet";
}

// ─── Placeholder device geometry ──────────────────────────────────────────────
// This is a geometric placeholder until real GLTF models are sourced.
// The screen material slot is `screenMaterialRef` — swap it with VideoTexture.
// Real GLTF models replace this component entirely but honour the same `values` API.

export function DeviceMesh({ values, screenTexture, deviceType }: DeviceMeshProps) {
	const groupRef = useRef<THREE.Group>(null);
	const screenMeshRef = useRef<THREE.Mesh>(null);
	const targetRotation = useRef(new THREE.Euler());
	const targetPosition = useRef(new THREE.Vector3());
	const targetScale = useRef(1);

	// Device dimensions per type
	const dims: Record<string, [number, number, number]> = {
		phone: [1.1, 2.3, 0.08],
		laptop: [2.8, 1.8, 0.06],
		tablet: [1.9, 2.5, 0.07],
	};
	const [w, h, d] = dims[deviceType] ?? dims.phone;

	// Screen inset dimensions (slightly smaller than device face)
	const sw = w * 0.85;
	const sh = h * 0.88;

	useFrame(() => {
		const group = groupRef.current;
		if (!group) return;

		targetRotation.current.set(
			(values["rotation.x"] ?? 0) * DEG2RAD,
			(values["rotation.y"] ?? 0) * DEG2RAD,
			(values["rotation.z"] ?? 0) * DEG2RAD,
		);
		targetPosition.current.set(
			values["position.x"] ?? 0,
			values["position.y"] ?? 0,
			values["position.z"] ?? 0,
		);
		targetScale.current = values["scale"] ?? 1;

		// Smooth spring-like damping
		group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, targetRotation.current.x, 0.1);
		group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, targetRotation.current.y, 0.1);
		group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, targetRotation.current.z, 0.1);
		group.position.lerp(targetPosition.current, 0.1);

		const s = THREE.MathUtils.lerp(group.scale.x, targetScale.current, 0.1);
		group.scale.setScalar(s);
	});

	// Update screen texture when it changes
	const screenMaterial = screenTexture
		? new THREE.MeshBasicMaterial({ map: screenTexture })
		: new THREE.MeshStandardMaterial({ color: "#111111", roughness: 0.1, metalness: 0.1 });

	return (
		<group ref={groupRef}>
			{/* Device body */}
			<RoundedBox args={[w, h, d]} radius={0.08} smoothness={4}>
				<meshStandardMaterial color="#1a1a1f" roughness={0.2} metalness={0.8} />
			</RoundedBox>

			{/* Screen */}
			<mesh
				ref={screenMeshRef}
				position={[0, 0, d / 2 + 0.001]}
			>
				<planeGeometry args={[sw, sh]} />
				<primitive object={screenMaterial} attach="material" />
			</mesh>

			{/* Soft ground shadow */}
			<ContactShadows
				position={[0, -h / 2 - 0.01, 0]}
				opacity={0.4}
				scale={4}
				blur={2.5}
				far={3}
			/>
		</group>
	);
}
