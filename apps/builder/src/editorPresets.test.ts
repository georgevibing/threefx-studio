import { validateGraphDocument } from "@threefx/core";
import { describe, expect, it } from "vitest";
import { createEditorPresetGraph, EDITOR_PRESETS } from "./editorPresets";

describe("editor presets", () => {
  it("exposes the Wispy Smoke project template", () => {
    expect(EDITOR_PRESETS).toEqual([
      {
        id: "wispy-smoke",
        name: "Wispy Smoke",
        summary: "Procedural volume effect",
        description:
          "A ready-to-edit smoke graph with simulation, rendering, compositing, preview, and export.",
      },
    ]);
  });

  it("creates valid graph templates with stable ids", () => {
    const ids = new Set(EDITOR_PRESETS.map((preset) => preset.id));

    expect(ids.size).toBe(EDITOR_PRESETS.length);
    for (const preset of EDITOR_PRESETS) {
      const graph = createEditorPresetGraph(preset.id);
      const validation = validateGraphDocument(graph);

      expect(graph.name).not.toHaveLength(0);
      expect(graph.nodes.some((node) => node.type === "render.composite")).toBe(true);
      expect(validation.valid).toBe(true);
    }
  });
});
