import type { EffectIR } from "@threefx/core";

export interface ExportedFile {
  readonly path: string;
  readonly contents: string;
}

export interface EffectExportPackage {
  readonly effectName: string;
  readonly className: string;
  readonly graphHash: string;
  readonly files: readonly ExportedFile[];
  readonly mainClassSource: string;
  readonly usageSnippet: string;
  readonly readmeSnippet: string;
}

export interface ExportOptions {
  readonly className?: string;
  readonly includeReadme?: boolean;
}

export interface EffectExporter {
  exportEffect(ir: EffectIR, options?: ExportOptions): EffectExportPackage;
}
