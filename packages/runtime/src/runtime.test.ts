import { describe, expect, it } from "vitest";
import { getWebGPUFeatureStatus, isWebGPURenderer, resolveQualityProfile } from "./index";

describe("@threefx/runtime", () => {
  it("reports explicit WebGPU capability fields", () => {
    const status = getWebGPUFeatureStatus();

    expect(typeof status.supported).toBe("boolean");
    expect(typeof status.computeSupported).toBe("boolean");
    expect(typeof status.storageBuffersSupported).toBe("boolean");
    expect(typeof status.storageTexturesSupported).toBe("boolean");
    expect(["webgpu", "compat"]).toContain(status.renderer);
  });

  it("detects WebGPU renderer handles without importing renderer code", () => {
    expect(isWebGPURenderer({ isWebGPURenderer: true })).toBe(true);
    expect(isWebGPURenderer({ isWebGLRenderer: true })).toBe(false);
  });

  it("exposes cubic fluid-grid and ray budget presets", () => {
    const profile = resolveQualityProfile("high");

    expect(profile.maxRaySteps).toBeGreaterThan(0);
    expect(profile.shadowSteps).toBeGreaterThan(0);
    expect(profile.volumeGrid).toEqual([64, 64, 64]);
  });
});
