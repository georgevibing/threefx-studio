import { cloneJson } from "./clone";
import { validateGraphDocument } from "./validation";
import type { GraphDocument, ValidationResult } from "./types";

export function serializeGraphDocument(graph: GraphDocument): string {
  return `${JSON.stringify(cloneJson(graph), null, 2)}\n`;
}

export function deserializeGraphDocument(source: string): ValidationResult {
  const parsed = JSON.parse(source) as GraphDocument;
  return validateGraphDocument(parsed);
}
