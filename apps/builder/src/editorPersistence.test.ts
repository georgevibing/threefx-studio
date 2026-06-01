import { createWispySmokeGraph } from "@threefx/core";
import { describe, expect, it } from "vitest";
import { createStorageEditorPersistence, type EditorPersistenceStorage } from "./editorPersistence";

class MemoryStorage implements EditorPersistenceStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("editor persistence", () => {
  it("round-trips graph parameter values, node positions, and viewport", async () => {
    const storage = new MemoryStorage();
    const persistence = createStorageEditorPersistence("test-graph", storage);
    const graph = createWispySmokeGraph();
    const savedGraph = {
      ...graph,
      viewport: { x: -320, y: 144, zoom: 0.72 },
      nodes: graph.nodes.map((node) =>
        node.id === "emitter"
          ? {
              ...node,
              position: [123, 456] as const,
              parameters: {
                ...(node.parameters ?? {}),
                density: 1.42,
                radius: 0.68,
              },
            }
          : node,
      ),
    };

    await persistence.save({ graph: savedGraph });
    const result = await persistence.load();

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      return;
    }
    expect(result.valid).toBe(true);
    expect(result.state.graph.viewport).toEqual(savedGraph.viewport);
    expect(result.state.graph.nodes.find((node) => node.id === "emitter")).toMatchObject({
      position: [123, 456],
      parameters: expect.objectContaining({
        density: 1.42,
        radius: 0.68,
      }),
    });
  });

  it("reports missing and malformed saved graphs without throwing", async () => {
    const storage = new MemoryStorage();
    const persistence = createStorageEditorPersistence("test-graph", storage);

    await expect(persistence.load()).resolves.toEqual({ status: "missing" });

    storage.setItem("test-graph", "{");
    const result = await persistence.load();

    expect(result.status).toBe("error");
  });
});
