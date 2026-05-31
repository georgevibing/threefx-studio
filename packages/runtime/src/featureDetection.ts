export interface WebGPUFeatureStatus {
  readonly supported: boolean;
  readonly computeSupported: boolean;
  readonly storageBuffersSupported: boolean;
  readonly storageTexturesSupported: boolean;
  readonly renderer: "webgpu" | "compat";
  readonly reason?: string;
}

export function getWebGPUFeatureStatus(): WebGPUFeatureStatus {
  const candidate = globalThis.navigator as Navigator & { gpu?: unknown };
  if (!candidate.gpu) {
    return {
      supported: false,
      computeSupported: false,
      storageBuffersSupported: false,
      storageTexturesSupported: false,
      renderer: "compat",
      reason: "WebGPU is not exposed by this browser. ThreeFX preview will use a compatible Three.js renderer path.",
    };
  }
  return {
    supported: true,
    computeSupported: true,
    storageBuffersSupported: true,
    storageTexturesSupported: true,
    renderer: "webgpu",
  };
}

export function isWebGPURenderer(renderer: unknown): boolean {
  return Boolean(
    renderer &&
      typeof renderer === "object" &&
      "isWebGPURenderer" in renderer &&
      (renderer as { readonly isWebGPURenderer?: unknown }).isWebGPURenderer === true,
  );
}
