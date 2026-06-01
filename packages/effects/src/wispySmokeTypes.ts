import type {
  CurveValue,
  QualityPreset,
  Vec3,
  WispySmokeAdvectionMode,
  WispySmokeBackendMode,
  WispySmokeBlendMode,
  WispySmokeDebugView,
  WispySmokeGridResolution,
  WispySmokeRuntimeConfig,
} from "@threefx/core";

export interface WispySmokeVFXParams {
  readonly spawnRate: number;
  readonly lifetime: number;
  readonly density: number;
  readonly baseDensity: number;
  readonly opacity: number;
  readonly opacityRamp: CurveValue;
  readonly size: number;
  readonly radius: number;
  readonly height: number;
  readonly sourcePosition: Vec3;
  readonly sourceScale: Vec3;
  readonly sourceVelocity: Vec3;
  readonly sourceFalloff: number;
  readonly sourceNoiseScale: number;
  readonly sourceNoiseStrength: number;
  readonly riseSpeed: number;
  readonly buoyantLift: number;
  readonly wind: Vec3;
  readonly vortexPosition: Vec3;
  readonly vortexRadius: number;
  readonly vortexStrength: number;
  readonly turbulence: number;
  readonly turbulenceBands: number;
  readonly curlStrength: number;
  readonly vorticityConfinement: number;
  readonly dissipation: number;
  readonly densityDissipation: number;
  readonly velocityDissipation: number;
  readonly pressureIterations: number;
  readonly diffusion: number;
  readonly diffusionIterations: number;
  readonly advectionMode: WispySmokeAdvectionMode;
  readonly sourceTemperature: number;
  readonly plumeTaper: number;
  readonly softness: number;
  readonly color: string;
  readonly emissionColor: string;
  readonly emissionIntensity: number;
  readonly absorption: number;
  readonly scattering: number;
  readonly detailScale: number;
  readonly detailStrength: number;
  readonly detailSpeed: number;
  readonly detailOctaves: number;
  readonly flowWarpStrength: number;
  readonly lightDirection: Vec3;
  readonly phaseAnisotropy: number;
  readonly shadowStrength: number;
  readonly blendMode: WispySmokeBlendMode;
  readonly sourceGlowEnabled: boolean;
  readonly sourceGlowColor: string;
  readonly sourceGlowIntensity: number;
  readonly sourceGlowRadius: number;
  readonly sourceGlowSoftness: number;
  readonly seed: number;
  readonly quality: QualityPreset;
  readonly backendMode: WispySmokeBackendMode;
  readonly gridResolution: WispySmokeGridResolution;
  readonly renderStepScale: number;
  readonly shadowQuality: number;
  readonly debugView: WispySmokeDebugView;
  readonly worldPosition: Vec3;
  readonly obstaclePosition: Vec3;
  readonly obstacleScale: Vec3;
  readonly obstacleRadius: number;
  readonly obstacleSoftness: number;
}

export interface WispySmokeVFXStats {
  readonly activeDebugView: WispySmokeDebugView;
  readonly advectionMode: WispySmokeAdvectionMode;
  readonly backend: "webgpu" | "compat";
  readonly diffusionIterations: number;
  readonly emitterCount: number;
  readonly fallbackActive: boolean;
  readonly fieldCount: number;
  readonly forceCount: number;
  readonly gridCells: number;
  readonly gridResolution: Vec3;
  readonly obstacleCount: number;
  readonly pressureIterations: number;
  readonly requestedBackend: WispySmokeBackendMode;
  readonly renderSteps: number;
  readonly simulationMs: number;
  readonly solverPasses: number;
}

export type WispySmokeVFXOptions = Partial<WispySmokeVFXParams> & {
  readonly config?: Partial<WispySmokeRuntimeConfig>;
  readonly renderer?: unknown;
  readonly position?: Vec3;
};
