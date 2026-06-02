import { describe, expect, it } from "vitest";
import {
  canAssignPortType,
  compileGraphToIR,
  createDefaultWispySmokeParams,
  createLayeredWispySmokeCompositeGraph,
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
      "medium",
    );

    const spawnRatePort = registry.get("emitter.sphere")?.ports.find((port) => port.id === "spawnRate");
    expect(spawnRatePort).toMatchObject({
      defaultValue: 1350,
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
        "flowWarpStrength",
        "lightDirection",
        "phaseAnisotropy",
        "shadowStrength",
        "emissionThreshold",
        "renderOrder",
      ]),
    );
    expect(registry.get("emitter.smoke")?.ports.some((port) => port.id === "emitter")).toBe(true);
    expect(registry.get("emitter.heat")?.ports.some((port) => port.id === "coreTemperature")).toBe(true);
    expect(registry.get("render.composite")?.ports.map((port) => port.id)).toEqual(
      expect.arrayContaining(["layers", "bloomEnabled", "bloomStrength", "toneMapping", "render"]),
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

  it("compiles channel-aware emitters and composite settings", () => {
    const result = compileGraphToIR(createLayeredWispySmokeCompositeGraph());
    expect(result.ir).toBeTruthy();

    const config = result.ir?.runtimeConfig;
    expect(config?.emitters.map((entry) => [entry.id, entry.kind, entry.channels])).toEqual([
      ["heat_source", "heat", ["temperature"]],
      ["smoke_source", "smoke", ["density", "velocity"]],
    ]);
    expect(config?.composite.bloom.enabled).toBe(true);
    expect(config?.composite.layers.map((layer) => layer.sourceNodeId)).toEqual(["volume_render"]);
    expect(config?.composite.toneMapping).toBe("renderer");
    expect(config?.emitters.find((entry) => entry.id === "smoke_source")).toMatchObject({
      density: 0.3,
      radius: 0.5,
      spawnRate: 1350,
    });
    expect(config?.forces.find((entry) => entry.id === "buoyancy")).toMatchObject({
      buoyantLift: 0.65,
      riseSpeed: 0.75,
    });
    expect(config?.fields.find((entry) => entry.id === "curl_field")).toMatchObject({
      curlStrength: 35,
      strength: 7,
      vorticityConfinement: 15.69,
    });
    expect(config?.solver).toMatchObject({
      densityDissipation: 1,
      pressureIterations: 4,
      velocityDissipation: 0.35,
    });
    expect(config?.render).toMatchObject({
      emissionThreshold: 0.72,
      opacity: 0.85,
    });
    expect(result.ir?.parameterValues).toMatchObject({
      height: 10,
      size: 15,
    });
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
        "coreTemperature",
        "emissionColor",
        "emissionIntensity",
        "emissionThreshold",
        "absorption",
        "scattering",
        "detailScale",
        "detailStrength",
        "detailSpeed",
        "detailOctaves",
        "flowWarpStrength",
        "bloomEnabled",
        "toneMapping",
        "lightDirection",
        "phaseAnisotropy",
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
    ).toBe(1.1);
  });

  it("keeps runtime config fallbacks aligned with metadata defaults", () => {
    const defaults = createDefaultWispySmokeParams();
    const config = createWispySmokeRuntimeConfig();
    const emitter = config.emitters[0];

    expect(config.solver.gridResolution).toBe(defaults.gridResolution);
    expect(config.render.renderStepScale).toBe(defaults.renderStepScale);
    expect(config.render.detailOctaves).toBe(defaults.detailOctaves);
    expect(config.render.detailSpeed).toBe(defaults.detailSpeed);
    expect(config.render.flowWarpStrength).toBe(defaults.flowWarpStrength);
    expect(config.render.emissionThreshold).toBe(defaults.emissionThreshold);
    expect(config.render.lightDirection).toEqual(defaults.lightDirection);
    expect(config.render.phaseAnisotropy).toBe(defaults.phaseAnisotropy);
    expect(config.render.smokeColor).toBe(defaults.color);
    expect(config.composite.bloom.enabled).toBe(defaults.bloomEnabled);
    expect(config.composite.toneMapping).toBe(defaults.toneMapping);
    expect(emitter?.channels).toEqual(["density", "temperature", "velocity"]);
    expect(emitter?.temperature).toBe(defaults.coreTemperature);
    expect(emitter?.falloff).toBe(defaults.sourceFalloff);
    expect(emitter?.noiseScale).toBe(defaults.sourceNoiseScale);
    expect(emitter?.noiseStrength).toBe(defaults.sourceNoiseStrength);
    expect(emitter?.radius).toBe(defaults.radius);
    expect(emitter?.velocity).toEqual(defaults.sourceVelocity);
  });

  it("preserves extended scalar controls in runtime config", () => {
    const config = createWispySmokeRuntimeConfig({
      detailStrength: 88,
      flowWarpStrength: 18,
      pressureIterations: 72,
      velocityDissipation: 64,
    });

    expect(config.render.detailStrength).toBe(88);
    expect(config.render.flowWarpStrength).toBe(18);
    expect(config.solver.pressureIterations).toBe(72);
    expect(config.solver.velocityDissipation).toBe(64);
  });
});
