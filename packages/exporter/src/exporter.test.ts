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
    expect(exported.mainClassSource).toContain("normalizeRuntimeConfig");
    expect(exported.mainClassSource).toContain("setRuntimeConfig");
    expect(exported.mainClassSource).toContain("sourceGlow");
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
    expect(exported.mainClassSource).toContain("Beer");
    expect(exported.mainClassSource).toContain("absorption");
    expect(exported.mainClassSource).toContain("scattering");
    expect(exported.mainClassSource).toContain("detailScale");
    expect(exported.mainClassSource).toContain("sourceTemperature");
    expect(exported.mainClassSource).toContain("emissionColor");
    expect(exported.mainClassSource).toContain("bakedLight");
    expect(exported.mainClassSource).toContain("selfShadow");
    expect(exported.mainClassSource).toContain("resolveEffectiveGridResolution");
    expect(exported.mainClassSource).not.toContain("triNoise3D");
    expect(exported.mainClassSource).not.toContain("Data3DTexture");
    expect(exported.mainClassSource).not.toContain("SpriteMaterial");
    expect(exported.mainClassSource).not.toContain("createSmokeVeilTextures");
    expect(exported.mainClassSource).not.toContain("splatReference");
    expect(exported.mainClassSource).not.toContain("carveFast");
    expect(exported.mainClassSource).not.toContain("packVolumeTextureChannels");
    expect(exported.mainClassSource).not.toContain("@threefx/");
    expect(exported.mainClassSource).not.toContain("warmGlow");
    expect(exported.mainClassSource).toContain("update(deltaSeconds");
    expect(exported.usageSnippet).toContain("scene.add(smoke.object3D)");
    expect(exported.usageSnippet).toContain('gridResolution: "high"');
    expect(exported.usageSnippet).toContain('emissionColor: "#d7e7ef"');
    expect(exported.usageSnippet).toContain("sourceGlowEnabled: false");
    expect(exported.usageSnippet).toContain("renderStepScale: 1.25");
    expect(exported.usageSnippet).toContain("pressureIterations: 12");
    expect(exported.usageSnippet).toContain('debugView: "final"');
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
