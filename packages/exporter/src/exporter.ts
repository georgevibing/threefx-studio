import { zipSync, strToU8 } from "fflate";
import type { EffectIR } from "@threefx/core";
import {
  createManifestSource,
  createReadmeSnippet,
  createUsageSnippet,
  createWispySmokeClassSource,
} from "./wispySmokeTemplate";
import type { EffectExportPackage, ExportOptions, ExportedFile } from "./types";

function sanitizeClassName(name: string): string {
  const normalized = name
    .replace(/[^A-Za-z0-9_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  const className = normalized.endsWith("VFX") ? normalized : `${normalized}VFX`;
  return /^[A-Za-z_]/.test(className) ? className : `Effect${className}`;
}

export function exportEffectToTypeScript(
  ir: EffectIR,
  options: ExportOptions = {},
): EffectExportPackage {
  if (ir.effectType !== "wispy-smoke") {
    throw new Error(`Unsupported effect type '${ir.effectType}'.`);
  }
  const className = options.className ?? sanitizeClassName(ir.effectName);
  const mainClassSource = createWispySmokeClassSource(ir, className);
  const usageSnippet = createUsageSnippet(className);
  const readmeSnippet = createReadmeSnippet(ir, className);
  const files: ExportedFile[] = [
    { path: `${className}.ts`, contents: mainClassSource },
    { path: "usage.ts", contents: usageSnippet },
    { path: "threefx-export.json", contents: createManifestSource(ir, className) },
  ];
  if (options.includeReadme ?? true) {
    files.push({ path: "README.md", contents: readmeSnippet });
  }
  return {
    effectName: ir.effectName,
    className,
    graphHash: ir.graphHash,
    files,
    mainClassSource,
    usageSnippet,
    readmeSnippet,
  };
}

export function createExportZip(exportPackage: EffectExportPackage): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of exportPackage.files) {
    entries[file.path] = strToU8(file.contents);
  }
  return zipSync(entries, { level: 6 });
}
