import { createDefaultWispySmokeParams, WISPY_SMOKE_PARAMETER_METADATA } from "@threefx/core";
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
    color: params.color ?? DEFAULT_WISPY_SMOKE_PARAMS.color,
    gridResolution: params.gridResolution ?? DEFAULT_WISPY_SMOKE_PARAMS.gridResolution,
    opacityRamp: params.opacityRamp ?? DEFAULT_WISPY_SMOKE_PARAMS.opacityRamp,
    quality: params.quality ?? DEFAULT_WISPY_SMOKE_PARAMS.quality,
    worldPosition: params.worldPosition ?? DEFAULT_WISPY_SMOKE_PARAMS.worldPosition,
    wind: params.wind ?? DEFAULT_WISPY_SMOKE_PARAMS.wind,
  };
}
