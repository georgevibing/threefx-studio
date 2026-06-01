import { validateGraphDocument } from "@threefx/core";
import { describe, expect, it } from "vitest";
import { createEditorPresetGraph, EDITOR_PRESETS } from "./editorPresets";

describe("editor presets", () => {
  it("only exposes the raw Wispy Smoke template", () => {
    expect(EDITOR_PRESETS).toEqual([
      {
        id: "wispy-smoke",
        name: "Wispy Smoke",
        summary: "Neutral billowing plume",
        description: "Default production graph tuned for dense gray smoke, rolling structure, and export.",
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
      expect(validation.valid).toBe(true);
    }
  });
});
