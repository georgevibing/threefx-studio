import type { CurveValue, QualityPreset, Vec3, WispySmokeBackendMode, WispySmokeGridResolution } from "@threefx/core";

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
  readonly riseSpeed: number;
  readonly buoyantLift: number;
  readonly turbulence: number;
  readonly turbulenceBands: number;
  readonly curlStrength: number;
  readonly vorticityConfinement: number;
  readonly dissipation: number;
  readonly densityDissipation: number;
  readonly velocityDissipation: number;
  readonly pressureIterations: number;
  readonly diffusion: number;
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
  readonly seed: number;
  readonly quality: QualityPreset;
  readonly backendMode: WispySmokeBackendMode;
  readonly gridResolution: WispySmokeGridResolution;
  readonly renderStepScale: number;
  readonly shadowQuality: number;
  readonly worldPosition: Vec3;
  readonly wind: Vec3;
}

export interface WispySmokeVFXStats {
  readonly backend: "webgpu" | "compat";
  readonly fallbackActive: boolean;
  readonly gridCells: number;
  readonly gridResolution: Vec3;
  readonly pressureIterations: number;
  readonly requestedBackend: WispySmokeBackendMode;
  readonly renderSteps: number;
  readonly simulationMs: number;
  readonly solverPasses: number;
}

export type WispySmokeVFXOptions = Partial<WispySmokeVFXParams> & {
  readonly renderer?: unknown;
  readonly position?: Vec3;
};
