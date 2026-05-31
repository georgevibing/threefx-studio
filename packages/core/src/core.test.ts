import { describe, expect, it } from "vitest";
import {
  canAssignPortType,
  compileGraphToIR,
  createNodeRegistry,
  createWispySmokeGraph,
  deserializeGraphDocument,
  isEditableValuePort,
  resolveWispySmokeParameterValues,
  serializeGraphDocument,
  THREEFX_GRAPH_SCHEMA_VERSION,
  validateGraphDocument,
  WISPY_SMOKE_PARAMETER_METADATA,
  type GraphDocument,
} from "./index";

describe("@threefx/core", () => {
  it("serializes and deserializes the graph schema", () => {
    const graph = createWispySmokeGraph();
    const result = deserializeGraphDocument(serializeGraphDocument(graph));
    expect(result.valid).toBe(true);
    expect(result.graph.schemaVersion).toBe(THREEFX_GRAPH_SCHEMA_VERSION);
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

  it("registers generic primitive parameter nodes and value input ports", () => {
    const registry = createNodeRegistry();
    expect(registry.get("parameter.spawnRate")).toBeNull();

    const floatParameter = registry.get("parameter.float");
    expect(floatParameter).toMatchObject({
      category: "Parameters",
      kind: "parameter",
      label: "Float",
      type: "parameter.float",
    });
    expect(floatParameter?.ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "output",
          id: "value",
          multiple: true,
          type: "float",
        }),
      ]),
    );
    expect(registry.instantiate("parameter.quality", "quality", [0, 0]).parameters?.value).toBe(
      "high",
    );

    const spawnRatePort = registry.get("emitter.volume")?.ports.find((port) => port.id === "spawnRate");
    expect(spawnRatePort).toMatchObject({
      defaultValue: 118,
      direction: "input",
      effectParameterId: "spawnRate",
      group: "Emission",
      type: "float",
    });
    expect(spawnRatePort ? isEditableValuePort(spawnRatePort) : false).toBe(true);

    const renderPorts = registry.get("render.volume")?.ports.map((port) => port.id);
    expect(renderPorts).toEqual(
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

  it("validates inline value inputs without edges but keeps structural inputs required", () => {
    const graph = createWispySmokeGraph();
    const inlineSpawn = {
      ...graph,
      edges: graph.edges.filter((edge) => edge.id !== "spawnRate_to_emitter"),
      nodes: graph.nodes.map((node) =>
        node.id === "emitter"
          ? { ...node, parameters: { ...(node.parameters ?? {}), spawnRate: 42 } }
          : node,
      ),
    };
    expect(validateGraphDocument(inlineSpawn).valid).toBe(true);

    const missingStructure = {
      ...graph,
      edges: graph.edges.filter((edge) => edge.id !== "emitter_to_buoyancy"),
    };
    const result = validateGraphDocument(missingStructure);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "missing-required-input")).toBe(true);
  });

  it("resolves defaults, graph parameter fallbacks, inline values, and linked values in order", () => {
    const linked = {
      ...createWispySmokeGraph(),
      nodes: createWispySmokeGraph().nodes.map((node) => {
        if (node.id === "param_spawnRate") {
          return { ...node, parameters: { value: 77 } };
        }
        if (node.id === "emitter") {
          return { ...node, parameters: { ...(node.parameters ?? {}), spawnRate: 42 } };
        }
        return node;
      }),
    };
    expect(resolveWispySmokeParameterValues(linked).spawnRate).toBe(77);

    const inline = {
      ...linked,
      edges: linked.edges.filter((edge) => edge.id !== "spawnRate_to_emitter"),
    };
    expect(resolveWispySmokeParameterValues(inline).spawnRate).toBe(42);

    const fallback = {
      ...inline,
      parameters: { ...inline.parameters, spawnRate: 33 },
      nodes: inline.nodes.map((node) => {
        if (node.id !== "emitter") {
          return node;
        }
        const { spawnRate: _spawnRate, ...parameters } = node.parameters ?? {};
        return { ...node, parameters };
      }),
    } satisfies GraphDocument;
    expect(resolveWispySmokeParameterValues(fallback).spawnRate).toBe(33);
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
