import { describe, expect, it } from "vitest";
import {
  canAssignPortType,
  compileGraphToIR,
  createDefaultWispySmokeParams,
  createNodeRegistry,
  createWispySmokeGraph,
  createWispySmokeRuntimeConfig,
  deserializeGraphDocument,
  isEditableValuePort,
  resolveWispySmokeParameterValues,
  serializeGraphDocument,
  THREEFX_GRAPH_SCHEMA_VERSION,
  THREEFX_IR_SCHEMA_VERSION,
  validateGraphDocument,
  WISPY_SMOKE_PARAMETER_METADATA,
  type GraphDocument,
} from "./index";

describe("@threefx/core", () => {
  it("keeps current graph and IR schemas at v1 without migrations", () => {
    expect(THREEFX_GRAPH_SCHEMA_VERSION).toBe(1);
    expect(THREEFX_IR_SCHEMA_VERSION).toBe(1);

    const unsupported = deserializeGraphDocument(
      JSON.stringify({ ...createWispySmokeGraph(), schemaVersion: 2 }),
    );
    expect(unsupported.valid).toBe(false);
    expect(unsupported.diagnostics.some((entry) => entry.path === "schemaVersion")).toBe(true);
  });

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
    const node = registry.instantiate("field.curl", "curl", [10, 20]);
    expect(node.label).toBe("Curl Field");
    expect(registry.get("field.curl")?.ports.some((port) => port.id === "field")).toBe(true);
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

    const spawnRatePort = registry.get("emitter.sphere")?.ports.find((port) => port.id === "spawnRate");
    expect(spawnRatePort).toMatchObject({
      defaultValue: 960,
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
        "detailOctaves",
        "shadowStrength",
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
      edges: graph.edges.filter((edge) => edge.id !== "emitter_to_solver"),
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
    expect(first.ir?.runtimeConfig.emitters).toHaveLength(1);
    expect(first.ir?.runtimeConfig.forces.length).toBeGreaterThanOrEqual(2);
    expect(first.ir?.runtimeConfig.solver.advectionMode).toBe("maccormack");
  });

  it("compiles stable runtime config arrays for multiple emitters, forces, and obstacles", () => {
    const base = createWispySmokeGraph();
    const graph: GraphDocument = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: "box_emitter",
          type: "emitter.box",
          label: "Box Emitter",
          position: [100, 100],
          parameters: { spawnRate: 84, sourcePosition: [0.25, 0.1, 0] },
        },
        {
          id: "wind_force",
          type: "force.wind",
          label: "Wind Force",
          position: [200, 100],
          parameters: { wind: [0.2, 0.1, -0.05] },
        },
        {
          id: "sphere_obstacle",
          type: "obstacle.sphere",
          label: "Sphere Obstacle",
          position: [300, 100],
          parameters: { obstaclePosition: [0, 1, 0], obstacleRadius: 0.4 },
        },
      ],
      edges: [
        ...base.edges,
        {
          id: "box_emitter_to_solver",
          source: "box_emitter",
          sourcePort: "emitter",
          target: "fluid_solver",
          targetPort: "emitter",
        },
        {
          id: "wind_force_to_solver",
          source: "wind_force",
          sourcePort: "force",
          target: "fluid_solver",
          targetPort: "force",
        },
        {
          id: "sphere_obstacle_to_solver",
          source: "sphere_obstacle",
          sourcePort: "obstacle",
          target: "fluid_solver",
          targetPort: "obstacle",
        },
      ],
    };

    const first = compileGraphToIR(graph).ir?.runtimeConfig;
    const second = compileGraphToIR(graph).ir?.runtimeConfig;
    expect(first).toEqual(second);
    expect(first?.emitters.map((entry) => entry.id)).toEqual(["box_emitter", "emitter"]);
    expect(first?.forces.map((entry) => entry.id)).toEqual(["buoyancy", "vortex", "wind_force"]);
    expect(first?.obstacles.map((entry) => entry.id)).toEqual(["sphere_obstacle"]);
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
        "detailOctaves",
        "sourceGlowColor",
        "debugView",
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
    ).toBe(1.7);
  });

  it("keeps runtime config fallbacks aligned with metadata defaults", () => {
    const defaults = createDefaultWispySmokeParams();
    const config = createWispySmokeRuntimeConfig();
    const emitter = config.emitters[0];

    expect(config.solver.gridResolution).toBe(defaults.gridResolution);
    expect(config.render.renderStepScale).toBe(defaults.renderStepScale);
    expect(config.render.detailOctaves).toBe(defaults.detailOctaves);
    expect(config.render.detailSpeed).toBe(defaults.detailSpeed);
    expect(config.render.smokeColor).toBe(defaults.color);
    expect(config.sourceGlow.enabled).toBe(defaults.sourceGlowEnabled);
    expect(config.sourceGlow.color).toBe(defaults.sourceGlowColor);
    expect(config.sourceGlow.intensity).toBe(defaults.sourceGlowIntensity);
    expect(emitter?.falloff).toBe(defaults.sourceFalloff);
    expect(emitter?.noiseScale).toBe(defaults.sourceNoiseScale);
    expect(emitter?.noiseStrength).toBe(defaults.sourceNoiseStrength);
    expect(emitter?.radius).toBe(defaults.radius);
    expect(emitter?.velocity).toEqual(defaults.sourceVelocity);
  });
});
