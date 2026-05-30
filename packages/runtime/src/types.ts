import type * as THREE from "three";

export type Vec3Tuple = readonly [number, number, number];

export interface VFXEffect<TParams> {
  readonly object3D: THREE.Object3D;
  init?(): Promise<void>;
  update(deltaSeconds: number, elapsedSeconds?: number): void | Promise<void>;
  setParams(params: Partial<TParams>): void;
  getParams(): Readonly<TParams>;
  dispose(): void;
}

export interface RuntimeQualityProfile {
  readonly id: "low" | "medium" | "high" | "cinematic";
  readonly maxParticles: number;
  readonly textureSize: number;
  readonly simulationScale: number;
}
