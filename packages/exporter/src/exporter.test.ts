import { describe, expect, it } from "vitest";
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
    expect(exported.mainClassSource).toContain("update(deltaSeconds");
    expect(exported.usageSnippet).toContain("scene.add(smoke.object3D)");
  });

  it("creates a browser zip payload", () => {
    const result = compileGraphToIR(createWispySmokeGraph());
    if (!result.ir) {
      throw new Error("Expected valid IR.");
    }
    const bytes = createExportZip(exportEffectToTypeScript(result.ir));
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });
});
