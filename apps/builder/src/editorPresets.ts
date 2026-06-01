import {
  createWispySmokeGraph,
  validateGraphDocument,
  type GraphDocument,
} from "@threefx/core";

export type EditorPresetId = "wispy-smoke";

export type EditorPreset = {
  readonly description: string;
  readonly id: EditorPresetId;
  readonly name: string;
  readonly summary: string;
};

export const EDITOR_PRESETS: readonly EditorPreset[] = [
  {
    id: "wispy-smoke",
    name: "Wispy Smoke",
    summary: "Neutral billowing plume",
    description: "Default production graph tuned for dense gray smoke, rolling structure, and export.",
  },
];

export function createEditorPresetGraph(presetId: EditorPresetId): GraphDocument {
  if (presetId !== "wispy-smoke") {
    throw new Error(`Unknown editor preset '${presetId}'.`);
  }
  return createWispySmokeGraph();
}

export function getEditorPreset(presetId: EditorPresetId): EditorPreset {
  const preset = EDITOR_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    throw new Error(`Unknown editor preset '${presetId}'.`);
  }
  return preset;
}

export function validateEditorPresetGraphs(): void {
  for (const preset of EDITOR_PRESETS) {
    const result = validateGraphDocument(createEditorPresetGraph(preset.id));
    if (!result.valid) {
      throw new Error(`Invalid editor preset '${preset.id}'.`);
    }
  }
}
