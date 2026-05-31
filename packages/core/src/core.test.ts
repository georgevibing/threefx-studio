import { describe, expect, it } from "vitest";
import {
  canAssignPortType,
  compileGraphToIR,
  createNodeRegistry,
  createWispySmokeGraph,
  deserializeGraphDocument,
  serializeGraphDocument,
  validateGraphDocument,
  WISPY_SMOKE_PARAMETER_METADATA,
} from "./index";

describe("@threefx/core", () => {
  it("serializes and deserializes the graph schema", () => {
    const graph = createWispySmokeGraph();
    const result = deserializeGraphDocument(serializeGraphDocument(graph));
    expect(result.valid).toBe(true);
    expect(result.graph.name).toBe("Wispy Smoke");
    expect(result.graph.nodes.length).toBeGreaterThan(8);
  });

  it("checks port compatibility with explicit assignment rules", () => {
    expect(canAssignPortType("int", "float")).toBe(true);
    expect(canAssignPortType("color", "float")).toBe(false);
    expect(canAssignPortType("quality", "quality")).toBe(true);
  });

  it("reports readable validation diagnostics", () => {
    const graph = createWispySmokeGraph();
    const broken = {
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: "bad_edge",
          source: "param_color",
          sourcePort: "value",
          target: "emitter",
          targetPort: "spawnRate",
        },
      ],
    };
    const result = validateGraphDocument(broken);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "port-type-mismatch")).toBe(true);
    expect(result.diagnostics.some((entry) => entry.code === "input-port-occupied")).toBe(true);
  });

  it("instantiates nodes from the registry", () => {
    const registry = createNodeRegistry();
    const node = registry.instantiate("noise.curl", "curl", [10, 20]);
    expect(node.label).toBe("Curl Noise");
    expect(registry.get("noise.curl")?.ports.some((port) => port.id === "field")).toBe(true);
  });

  it("attaches editable parameter metadata to composer nodes", () => {
    const registry = createNodeRegistry();
    expect(
      registry.get("emitter.volume")?.parameterMetadata?.map((parameter) => parameter.id),
    ).toEqual(
      expect.arrayContaining(["spawnRate", "lifetime", "radius", "height", "sourceTemperature"]),
    );
    expect(
      registry.get("render.volume")?.parameterMetadata?.map((parameter) => parameter.id),
    ).toEqual(
      expect.arrayContaining([
        "size",
        "opacity",
        "softness",
        "color",
        "baseDensity",
        "emissionColor",
        "absorption",
        "scattering",
        "detailScale",
        "detailStrength",
        "detailSpeed",
      ]),
    );
  });

  it("compiles deterministic Effect IR", () => {
    const graph = createWispySmokeGraph();
    const first = compileGraphToIR(graph);
    const second = compileGraphToIR(graph);
    expect(first.ir?.graphHash).toBe(second.ir?.graphHash);
    expect(first.ir?.kind).toBe("ThreeFXEffectIR");
    expect(first.ir?.runtime).toMatchObject({
      backendMode: "auto",
      fallback: "compat",
      renderModel: "volume-raymarch",
      solver: "eulerian-fluid-grid",
    });
    expect(first.ir?.nodes.map((node) => node.id)).toContain("volume_render");
  });

  it("exposes typed parameter metadata", () => {
    expect(WISPY_SMOKE_PARAMETER_METADATA.map((parameter) => parameter.id)).toEqual(
      expect.arrayContaining([
        "spawnRate",
        "lifetime",
        "density",
        "color",
        "pressureIterations",
        "diffusion",
        "sourceTemperature",
        "emissionColor",
        "emissionIntensity",
        "absorption",
        "scattering",
        "detailScale",
        "detailStrength",
        "detailSpeed",
        "quality",
        "backendMode",
      ]),
    );
    expect(
      WISPY_SMOKE_PARAMETER_METADATA.find((parameter) => parameter.id === "spawnRate")?.type,
    ).toBe("float");
    expect(
      WISPY_SMOKE_PARAMETER_METADATA.find((parameter) => parameter.id === "renderStepScale")
        ?.defaultValue,
    ).toBe(0.42);
  });
});
