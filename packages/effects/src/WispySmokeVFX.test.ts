import { describe, expect, it } from "vitest";
import { WispySmokeVFX } from "./WispySmokeVFX";
import { normalizeWispySmokeParams } from "./wispySmokeDefaults";

const webgpuRenderer = {
  isWebGPURenderer: true,
  compute(): void {
    // Tests only verify deterministic dispatch setup; real GPU execution is covered in preview.
  },
};

describe("WispySmokeVFX", () => {
  it("normalizes eulerian fluid runtime parameters", () => {
    const params = normalizeWispySmokeParams();

    expect(params.backendMode).toBe("auto");
    expect(params.gridResolution).toBe("high");
    expect(params.baseDensity).toBeGreaterThan(0);
    expect(params.color).toBe("#c7d2d8");
    expect(params.emissionColor).toBe("#d7e7ef");
    expect(params.sourceGlowEnabled).toBe(false);
    expect(params.sourceGlowColor).toBe("#c7d2d8");
    expect(params.pressureIterations).toBe(12);
    expect(params.diffusionIterations).toBe(1);
    expect(params.advectionMode).toBe("trilinear");
    expect(params.debugView).toBe("final");
    expect(params.diffusion).toBeGreaterThan(0);
    expect(params.absorption).toBeGreaterThan(0);
    expect(params.scattering).toBeGreaterThan(0);
    expect(params.detailScale).toBeGreaterThan(0);
    expect(params.detailOctaves).toBeGreaterThanOrEqual(1);
    expect(params.opacityRamp.length).toBeGreaterThan(2);
    expect("warmGlow" in params).toBe(false);
  });

  it("uses the WebGPU eulerian grid backend when a WebGPU renderer is provided", () => {
    const smoke = new WispySmokeVFX({
      backendMode: "webgpu",
      gridResolution: "low",
      quality: "low",
      renderer: webgpuRenderer,
      seed: 42,
    });

    smoke.update(1 / 30, 1);

    const stats = smoke.getStats();
    expect(stats.requestedBackend).toBe("webgpu");
    expect(stats.backend).toBe("webgpu");
    expect(stats.fallbackActive).toBe(false);
    expect(stats.gridResolution).toEqual([32, 32, 32]);
    expect(stats.gridCells).toBe(32 * 32 * 32);
    expect(stats.pressureIterations).toBe(12);
    expect(stats.solverPasses).toBe(24);
    expect(stats.simulationMs).toBeGreaterThanOrEqual(0);
    expect(stats.renderSteps).toBeGreaterThanOrEqual(16);
    expect(stats.advectionMode).toBe("trilinear");
    expect(stats.diffusionIterations).toBe(1);
    expect(stats.emitterCount).toBe(1);
    expect(stats.fieldCount).toBe(1);
    expect(stats.forceCount).toBe(1);
    expect(stats.obstacleCount).toBe(0);
    expect(stats.activeDebugView).toBe("final");
    const volume = smoke.object3D.children.find((child) => child.name === "WispySmokeVFXEulerianFluidVolume");
    const volumeMesh = volume as
      | { readonly material?: { readonly depthTest?: boolean; readonly depthWrite?: boolean; readonly outputNode?: unknown; readonly transparent?: boolean }; readonly renderOrder: number }
      | undefined;
    expect(volumeMesh).toBeDefined();
    expect(volumeMesh?.renderOrder).toBe(10);
    const material = volumeMesh?.material ?? null;
    expect(material).toMatchObject({
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    expect(material?.outputNode).toBeTruthy();
    expect(smoke.object3D.children.some((child) => child.type === "Sprite")).toBe(false);

    smoke.dispose();
  });

  it("maps quality presets to cubic simulation budgets", () => {
    const smoke = new WispySmokeVFX({
      backendMode: "webgpu",
      gridResolution: "cinematic",
      quality: "cinematic",
      renderer: webgpuRenderer,
    });

    expect(smoke.getStats().gridResolution).toEqual([96, 96, 96]);
    expect(smoke.getStats().gridCells).toBe(96 * 96 * 96);

    smoke.setParams({ quality: "medium", gridResolution: "medium" });

    expect(smoke.getStats().gridResolution).toEqual([48, 48, 48]);
    expect(smoke.getStats().gridCells).toBe(48 * 48 * 48);
    smoke.dispose();
  });

  it("clamps requested grid resolution to the selected quality tier", () => {
    const smoke = new WispySmokeVFX({
      backendMode: "webgpu",
      gridResolution: "high",
      quality: "medium",
      renderer: webgpuRenderer,
    });

    const stats = smoke.getStats();
    expect(stats.gridResolution).toEqual([48, 48, 48]);
    expect(stats.gridCells).toBe(48 * 48 * 48);
    expect(stats.renderSteps).toBeGreaterThanOrEqual(16);
    smoke.dispose();
  });

  it("reflects solver parameter changes in stats and normalized params", () => {
    const smoke = new WispySmokeVFX({
      backendMode: "webgpu",
      gridResolution: "low",
      quality: "low",
      renderer: webgpuRenderer,
    });

    smoke.setParams({
      absorption: 1.8,
      detailScale: 5.5,
      diffusion: 0.03,
      emissionColor: "#ff4a1c",
      emissionIntensity: 1.6,
      sourceGlowColor: "#ff8800",
      sourceGlowEnabled: true,
      sourceGlowIntensity: 4.2,
      pressureIterations: 24,
      scattering: 0.82,
      sourceTemperature: 1.5,
    });
    smoke.update(1 / 60, 2);

    expect(smoke.getStats().pressureIterations).toBe(24);
    expect(smoke.getStats().solverPasses).toBe(36);
    expect(smoke.getParams().emissionColor).toBe("#ff4a1c");
    expect(smoke.getParams().sourceGlowColor).toBe("#ff8800");
    expect(smoke.getStats().fallbackActive).toBe(false);
    expect(smoke.getParams().detailScale).toBe(5.5);
    smoke.dispose();
  });

  it("uses the lightweight compatibility fallback without WebGPU", () => {
    const smoke = new WispySmokeVFX({ backendMode: "auto", quality: "low", gridResolution: "low" });

    smoke.update(1 / 60, 1);

    const stats = smoke.getStats();
    expect(stats.backend).toBe("compat");
    expect(stats.fallbackActive).toBe(true);
    expect(stats.gridCells).toBe(0);
    expect(stats.solverPasses).toBe(0);
    expect(stats.simulationMs).toBe(0);
    expect(stats.renderSteps).toBeGreaterThanOrEqual(16);
    smoke.dispose();
  });
});
