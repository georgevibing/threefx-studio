import { describe, expect, it } from "vitest";
import ts from "typescript";
import { compileGraphToIR, createWispySmokeGraph } from "@threefx/core";
import { createExportZip, exportEffectToTypeScript } from "./index";

describe("@threefx/exporter", () => {
  it("exports a typed WispySmokeVFX source package", () => {
    const result = compileGraphToIR(createWispySmokeGraph());
    if (!result.ir) {
      throw new Error("Expected valid IR.");
    }
    const exported = exportEffectToTypeScript(result.ir, { className: "WispySmokeVFX" });
    expect(exported.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["WispySmokeVFX.ts", "usage.ts", "README.md"]),
    );
    expect(exported.mainClassSource).toContain("export class WispySmokeVFX");
    expect(exported.mainClassSource).toContain("interface WispySmokeVFXParams");
    expect(exported.mainClassSource).toContain("interface WispySmokeVFXStats");
    expect(exported.mainClassSource).toContain('"backendMode": "auto"');
    expect(exported.mainClassSource).toContain('from "three/webgpu"');
    expect(exported.mainClassSource).toContain("RUNTIME_SOLVER = \"eulerian-fluid-grid\"");
    expect(exported.mainClassSource).toContain("DEFAULT_RUNTIME_CONFIG");
    expect(exported.mainClassSource).toContain("interface WispySmokeRuntimeConfig");
    expect(exported.mainClassSource).toContain("WispySmokeEmitterChannel");
    expect(exported.mainClassSource).toContain("WispySmokeCompositeLayerConfig");
    expect(exported.mainClassSource).toContain("normalizeRuntimeConfig");
    expect(exported.mainClassSource).toContain("setRuntimeConfig");
    expect(exported.mainClassSource).toContain("render(renderer");
    expect(exported.mainClassSource).toContain("composite");
    expect(exported.mainClassSource).toContain("debugView");
    expect(exported.mainClassSource).toContain("class FluidGrid3D");
    expect(exported.mainClassSource).toContain("MeshBasicNodeMaterial");
    expect(exported.mainClassSource).toContain("outputNode = cloud");
    expect(exported.mainClassSource).toContain("depthTest = false");
    expect(exported.mainClassSource).toContain("Storage3DTexture");
    expect(exported.mainClassSource).toContain("HalfFloatType");
    expect(exported.mainClassSource).toContain("instancedArray");
    expect(exported.mainClassSource).toContain("textureStore");
    expect(exported.mainClassSource).toContain("RaymarchingBox");
    expect(exported.mainClassSource).toContain("VOLUME_RAYMARCH");
    expect(exported.mainClassSource).toContain("RGBAFormat");
    expect(exported.mainClassSource).toContain("createSourceNode");
    expect(exported.mainClassSource).toContain("createAdvectNode");
    expect(exported.mainClassSource).toContain("createBuoyancyNode");
    expect(exported.mainClassSource).toContain("createVorticityNode");
    expect(exported.mainClassSource).toContain("createDivergenceNode");
    expect(exported.mainClassSource).toContain("createJacobiNode");
    expect(exported.mainClassSource).toContain("createProjectionNode");
    expect(exported.mainClassSource).toContain("createPackNode");
    expect(exported.mainClassSource).toContain("const beer");
    expect(exported.mainClassSource).toContain("absorption");
    expect(exported.mainClassSource).toContain("scattering");
    expect(exported.mainClassSource).toContain("detailScale");
    expect(exported.mainClassSource).toContain("coreTemperature");
    expect(exported.mainClassSource).toContain("sourcePosition");
    expect(exported.mainClassSource).toContain("sourceScale");
    expect(exported.mainClassSource).toContain("sourceFalloff");
    expect(exported.mainClassSource).toContain("emissionThreshold");
    expect(exported.mainClassSource).toContain("effectiveEmissionThreshold");
    expect(exported.mainClassSource).toContain("emissionIntensity.mul(0.06)");
    expect(exported.mainClassSource).toContain("sourceCore.mul(0.55).add(1)");
    expect(exported.mainClassSource).toContain("emissionColor");
    expect(exported.mainClassSource).toContain("selfShadow");
    expect(exported.mainClassSource).toContain("valueNoise3D");
    expect(exported.mainClassSource).toContain("flowWarpStrength");
    expect(exported.mainClassSource).toContain("phaseAnisotropy");
    expect(exported.mainClassSource).toContain("lightDirection");
    expect(exported.mainClassSource).toContain("sampleVec4Range");
    expect(exported.mainClassSource).toContain('"advectionMode": "maccormack"');
    expect(exported.mainClassSource).toContain("resolveEffectiveGridResolution");
    expect(exported.mainClassSource).toContain(
      "return clamp(Math.round(params.pressureIterations), 4, 80);",
    );
    expect(exported.mainClassSource).not.toContain("triNoise3D");
    expect(exported.mainClassSource).not.toContain("Data3DTexture");
    expect(exported.mainClassSource).not.toContain("SpriteMaterial");
    expect(exported.mainClassSource).not.toContain("const center = vec3(0.5, 0.08, 0.5)");
    expect(exported.mainClassSource).not.toContain("SourceGlow");
    expect(exported.mainClassSource).not.toContain("sourceGlow");
    expect(exported.mainClassSource).not.toContain("sourceTemperature");
    expect(exported.mainClassSource).not.toContain("createSmokeVeilTextures");
    expect(exported.mainClassSource).not.toContain("splatReference");
    expect(exported.mainClassSource).not.toContain("carveFast");
    expect(exported.mainClassSource).not.toContain("packVolumeTextureChannels");
    expect(exported.mainClassSource).not.toContain("@threefx/");
    expect(exported.mainClassSource).not.toContain("warmGlow");
    expect(exported.mainClassSource).toContain("update(deltaSeconds");
    expect(exported.usageSnippet).toContain("scene.add(smoke.object3D)");
    expect(exported.usageSnippet).toContain('gridResolution: "high"');
    expect(exported.usageSnippet).toContain('emissionColor: "#b8bcc0"');
    expect(exported.usageSnippet).toContain("emissionIntensity: 0");
    expect(exported.usageSnippet).toContain("sourcePosition: [0, 0.22, 0]");
    expect(exported.usageSnippet).toContain("sourceScale: [0.92, 0.42, 0.92]");
    expect(exported.usageSnippet).toContain("sourceFalloff: 0.9");
    expect(exported.usageSnippet).toContain("coreTemperature: 1.1");
    expect(exported.usageSnippet).toContain("emissionThreshold: 0.72");
    expect(exported.usageSnippet).toContain('blendMode: "normal"');
    expect(exported.usageSnippet).toContain("renderOrder: 10");
    expect(exported.usageSnippet).toContain("riseSpeed: 1.2");
    expect(exported.usageSnippet).toContain("buoyantLift: 1.4");
    expect(exported.usageSnippet).toContain("sourceVelocity: [0, 0.34, 0]");
    expect(exported.usageSnippet).toContain("curlStrength: 9");
    expect(exported.usageSnippet).toContain("vorticityConfinement: 16");
    expect(exported.usageSnippet).toContain("detailScale: 22");
    expect(exported.usageSnippet).toContain("detailStrength: 4.4");
    expect(exported.usageSnippet).toContain("flowWarpStrength: 1.65");
    expect(exported.usageSnippet).toContain("bloomEnabled: false");
    expect(exported.usageSnippet).toContain('toneMapping: "renderer"');
    expect(exported.usageSnippet).toContain("lightDirection: [0.35, 0.85, 0.25]");
    expect(exported.usageSnippet).toContain("phaseAnisotropy: 0.32");
    expect(exported.usageSnippet).toContain("renderStepScale: 1.1");
    expect(exported.usageSnippet).toContain("pressureIterations: 16");
    expect(exported.usageSnippet).toContain('advectionMode: "maccormack"');
    expect(exported.usageSnippet).toContain('debugView: "final"');
    expect(exported.usageSnippet).toContain('color: "#b8bcc0"');
    expect(exported.usageSnippet).not.toContain("#ff8800");
  });

  it("creates a browser zip payload", () => {
    const result = compileGraphToIR(createWispySmokeGraph());
    if (!result.ir) {
      throw new Error("Expected valid IR.");
    }
    const bytes = createExportZip(exportEffectToTypeScript(result.ir));
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it("emits syntactically valid standalone TypeScript", () => {
    const result = compileGraphToIR(createWispySmokeGraph());
    if (!result.ir) {
      throw new Error("Expected valid IR.");
    }
    const exported = exportEffectToTypeScript(result.ir);
    const output = ts.transpileModule(exported.mainClassSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    });

    expect(output.diagnostics ?? []).toEqual([]);
  });
});
