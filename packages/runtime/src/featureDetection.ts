export interface WebGPUFeatureStatus {
  readonly supported: boolean;
  readonly reason?: string;
}

export function getWebGPUFeatureStatus(): WebGPUFeatureStatus {
  const candidate = globalThis.navigator as Navigator & { gpu?: unknown };
  if (!candidate.gpu) {
    return {
      supported: false,
      reason: "WebGPU is not exposed by this browser. ThreeFX preview will use a compatible Three.js renderer path.",
    };
  }
  return { supported: true };
}
