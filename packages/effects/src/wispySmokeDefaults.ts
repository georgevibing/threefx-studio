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
    color: params.color ?? DEFAULT_WISPY_SMOKE_PARAMS.color,
    quality: params.quality ?? DEFAULT_WISPY_SMOKE_PARAMS.quality,
    worldPosition: params.worldPosition ?? DEFAULT_WISPY_SMOKE_PARAMS.worldPosition,
    wind: params.wind ?? DEFAULT_WISPY_SMOKE_PARAMS.wind,
  };
}
