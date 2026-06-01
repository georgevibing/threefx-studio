import { validateGraphDocument } from "@threefx/core";
import { describe, expect, it } from "vitest";
import { createEditorPresetGraph, EDITOR_PRESETS } from "./editorPresets";

describe("editor presets", () => {
  it("creates valid graph templates with stable ids", () => {
    const ids = new Set(EDITOR_PRESETS.map((preset) => preset.id));

    expect(ids.size).toBe(EDITOR_PRESETS.length);
    for (const preset of EDITOR_PRESETS) {
      const graph = createEditorPresetGraph(preset.id);
      const validation = validateGraphDocument(graph);

      expect(graph.name).not.toHaveLength(0);
      expect(validation.valid).toBe(true);
    }
  });

  it("keeps parameter nodes mirrored with graph parameter defaults", () => {
    const graph = createEditorPresetGraph("tall-plume");
    const parameterNodes = new Map(graph.nodes.map((node) => [node.id, node]));

    expect(parameterNodes.get("param_quality")?.parameters?.value).toBe(graph.parameters.quality);
    expect(parameterNodes.get("param_opacity")?.parameters?.value).toBe(graph.parameters.opacity);
    expect(parameterNodes.get("param_spawnRate")?.parameters?.value).toBe(
      graph.parameters.spawnRate,
    );
  });
});
