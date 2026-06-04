import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial } from "@react-three/drei";

function Orb({ position, color, speed }) {
  const mesh = useRef();
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    mesh.current.rotation.x = Math.sin(clock.elapsedTime * speed * 0.25) * 0.2;
    mesh.current.rotation.y = Math.sin(clock.elapsedTime * speed * 0.18) * 0.3;
  });
  return (
    <Float speed={speed} rotationIntensity={0.3} floatIntensity={0.9}>
      <mesh ref={mesh} position={position}>
        <sphereGeometry args={[1, 64, 64]} />
        <MeshDistortMaterial color={color} distort={0.45} speed={1.8} transparent opacity={0.13} roughness={0} />
      </mesh>
    </Float>
  );
}

export default function Scene3D() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 58 }} style={{ background: "transparent" }}>
      <ambientLight intensity={0.4} />
      <pointLight position={[8, 8, 8]} intensity={1.2} />
      <pointLight position={[-8, -6, -6]} color="#00C9FF" intensity={0.6} />
      <Orb position={[-2.8, 1.6, -2]} color="#00E87A" speed={0.7} />
      <Orb position={[2.6, -1.2, -1.5]} color="#00C9FF" speed={1.1} />
      <Orb position={[0.4, -2.4, -3]} color="#00E87A" speed={0.5} />
    </Canvas>
  );
}
