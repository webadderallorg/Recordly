import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { FlatValues } from "@/hooks/engine/useAnimationTimeline";

interface CameraRigProps {
	values: FlatValues;
}

// Drives the Three.js camera from the interpolated Theatre.js values.
// Called every frame via useFrame so motion is always smooth.
export function CameraRig({ values }: CameraRigProps) {
	const { camera } = useThree();
	const targetPosition = useRef(new THREE.Vector3(0, 0, 5));
	const targetLookAt = useRef(new THREE.Vector3(0, 0, 0));

	useEffect(() => {
		if (values["position.x"] !== undefined) {
			targetPosition.current.set(
				values["position.x"] ?? 0,
				values["position.y"] ?? 0,
				values["position.z"] ?? 5,
			);
		}
		if (values["lookAt.x"] !== undefined) {
			targetLookAt.current.set(
				values["lookAt.x"] ?? 0,
				values["lookAt.y"] ?? 0,
				values["lookAt.z"] ?? 0,
			);
		}
		if (values["fov"] !== undefined && camera instanceof THREE.PerspectiveCamera) {
			camera.fov = values["fov"];
			camera.updateProjectionMatrix();
		}
	}, [values, camera]);

	useFrame(() => {
		// Smooth follow with spring-like damping (0.08 = responsive but not instant)
		camera.position.lerp(targetPosition.current, 0.08);
		camera.lookAt(targetLookAt.current);
	});

	return null;
}
