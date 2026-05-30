import type { QualityPreset, Vec3 } from "@threefx/core";

export interface WispySmokeVFXParams {
  readonly spawnRate: number;
  readonly lifetime: number;
  readonly density: number;
  readonly opacity: number;
  readonly size: number;
  readonly radius: number;
  readonly height: number;
  readonly riseSpeed: number;
  readonly turbulence: number;
  readonly curlStrength: number;
  readonly dissipation: number;
  readonly softness: number;
  readonly color: string;
  readonly seed: number;
  readonly quality: QualityPreset;
  readonly worldPosition: Vec3;
  readonly wind: Vec3;
  readonly warmGlow: boolean;
}

export interface WispySmokeVFXStats {
  readonly activeParticles: number;
  readonly maxParticles: number;
}

export type WispySmokeVFXOptions = Partial<WispySmokeVFXParams> & {
  readonly renderer?: unknown;
  readonly position?: Vec3;
};
