import {
  deserializeGraphDocument,
  serializeGraphDocument,
  type GraphDocument,
} from "@threefx/core";

export type PersistedEditorState = {
  readonly graph: GraphDocument;
};

export type EditorPersistenceLoadResult =
  | { readonly status: "missing" }
  | { readonly status: "loaded"; readonly state: PersistedEditorState; readonly valid: boolean }
  | { readonly status: "error"; readonly message: string };

export interface EditorPersistence {
  load(): Promise<EditorPersistenceLoadResult>;
  save(state: PersistedEditorState): Promise<void>;
}

export function createLocalStorageEditorPersistence(key: string): EditorPersistence {
  return {
    async load() {
      const source = window.localStorage.getItem(key);
      if (!source) {
        return { status: "missing" };
      }
      try {
        const result = deserializeGraphDocument(source);
        return {
          status: "loaded",
          state: { graph: result.graph },
          valid: result.valid,
        };
      } catch (error) {
        return {
          status: "error",
          message: error instanceof Error ? error.message : "Unknown persistence error",
        };
      }
    },
    async save(state) {
      window.localStorage.setItem(key, serializeGraphDocument(state.graph));
    },
  };
}
