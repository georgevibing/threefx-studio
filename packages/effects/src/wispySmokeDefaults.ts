import {
  createDefaultWispySmokeParams,
  createWispySmokeRuntimeConfig,
  WISPY_SMOKE_PARAMETER_METADATA,
  type ParameterMap,
  type WispySmokeRuntimeConfig,
} from "@threefx/core";
import type { WispySmokeVFXParams } from "./wispySmokeTypes";

export { WISPY_SMOKE_PARAMETER_METADATA };

export const DEFAULT_WISPY_SMOKE_PARAMS: WispySmokeVFXParams = {
  ...(createDefaultWispySmokeParams() as unknown as WispySmokeVFXParams),
};

export function normalizeWispySmokeParams(
  params: Partial<WispySmokeVFXParams> = {},
): WispySmokeVFXParams {
  return {
    ...DEFAULT_WISPY_SMOKE_PARAMS,
    ...params,
    backendMode: params.backendMode ?? DEFAULT_WISPY_SMOKE_PARAMS.backendMode,
    advectionMode: params.advectionMode ?? DEFAULT_WISPY_SMOKE_PARAMS.advectionMode,
    blendMode: params.blendMode ?? DEFAULT_WISPY_SMOKE_PARAMS.blendMode,
    color: params.color ?? DEFAULT_WISPY_SMOKE_PARAMS.color,
    debugView: params.debugView ?? DEFAULT_WISPY_SMOKE_PARAMS.debugView,
    sourcePosition: params.sourcePosition ?? DEFAULT_WISPY_SMOKE_PARAMS.sourcePosition,
    sourceScale: params.sourceScale ?? DEFAULT_WISPY_SMOKE_PARAMS.sourceScale,
    sourceVelocity: params.sourceVelocity ?? DEFAULT_WISPY_SMOKE_PARAMS.sourceVelocity,
    sourceGlowColor: params.sourceGlowColor ?? DEFAULT_WISPY_SMOKE_PARAMS.sourceGlowColor,
    gridResolution: params.gridResolution ?? DEFAULT_WISPY_SMOKE_PARAMS.gridResolution,
    obstaclePosition: params.obstaclePosition ?? DEFAULT_WISPY_SMOKE_PARAMS.obstaclePosition,
    obstacleScale: params.obstacleScale ?? DEFAULT_WISPY_SMOKE_PARAMS.obstacleScale,
    opacityRamp: params.opacityRamp ?? DEFAULT_WISPY_SMOKE_PARAMS.opacityRamp,
    quality: params.quality ?? DEFAULT_WISPY_SMOKE_PARAMS.quality,
    vortexPosition: params.vortexPosition ?? DEFAULT_WISPY_SMOKE_PARAMS.vortexPosition,
    worldPosition: params.worldPosition ?? DEFAULT_WISPY_SMOKE_PARAMS.worldPosition,
    wind: params.wind ?? DEFAULT_WISPY_SMOKE_PARAMS.wind,
  };
}

export function normalizeWispySmokeRuntimeConfig(
  params: WispySmokeVFXParams,
  config: Partial<WispySmokeRuntimeConfig> | undefined = undefined,
): WispySmokeRuntimeConfig {
  const base = createWispySmokeRuntimeConfig(params as unknown as ParameterMap);
  return {
    ...base,
    ...config,
    debug: {
      ...base.debug,
      ...(config?.debug ?? {}),
    },
    emitters: config?.emitters ?? base.emitters,
    fields: config?.fields ?? base.fields,
    forces: config?.forces ?? base.forces,
    obstacles: config?.obstacles ?? base.obstacles,
    render: {
      ...base.render,
      ...(config?.render ?? {}),
    },
    solver: {
      ...base.solver,
      ...(config?.solver ?? {}),
    },
    sourceGlow: {
      ...base.sourceGlow,
      ...(config?.sourceGlow ?? {}),
    },
    transform: {
      ...base.transform,
      ...(config?.transform ?? {}),
    },
  };
}
