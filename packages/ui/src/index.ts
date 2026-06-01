export interface Tone {
  readonly accent: string;
  readonly background: string;
  readonly border: string;
}

export const portTypeTones: Record<string, Tone> = {
  any: {
    accent: "#d4d4d8",
    background: "rgba(212, 212, 216, 0.1)",
    border: "rgba(212, 212, 216, 0.42)",
  },
  bool: {
    accent: "#a78bfa",
    background: "rgba(167, 139, 250, 0.13)",
    border: "rgba(167, 139, 250, 0.54)",
  },
  color: {
    accent: "#fb7185",
    background: "rgba(251, 113, 133, 0.13)",
    border: "rgba(251, 113, 133, 0.54)",
  },
  curve: {
    accent: "#fbbf24",
    background: "rgba(251, 191, 36, 0.13)",
    border: "rgba(251, 191, 36, 0.54)",
  },
  debug: {
    accent: "#f472b6",
    background: "rgba(244, 114, 182, 0.13)",
    border: "rgba(244, 114, 182, 0.54)",
  },
  effect: {
    accent: "#e5e7eb",
    background: "rgba(229, 231, 235, 0.1)",
    border: "rgba(229, 231, 235, 0.42)",
  },
  emitter: {
    accent: "#86efac",
    background: "rgba(134, 239, 172, 0.13)",
    border: "rgba(134, 239, 172, 0.54)",
  },
  field: {
    accent: "#67e8f9",
    background: "rgba(103, 232, 249, 0.13)",
    border: "rgba(103, 232, 249, 0.54)",
  },
  float: {
    accent: "#f59e0b",
    background: "rgba(245, 158, 11, 0.13)",
    border: "rgba(245, 158, 11, 0.54)",
  },
  flow: {
    accent: "#60a5fa",
    background: "rgba(96, 165, 250, 0.13)",
    border: "rgba(96, 165, 250, 0.54)",
  },
  force: {
    accent: "#facc15",
    background: "rgba(250, 204, 21, 0.13)",
    border: "rgba(250, 204, 21, 0.54)",
  },
  int: {
    accent: "#f97316",
    background: "rgba(249, 115, 22, 0.13)",
    border: "rgba(249, 115, 22, 0.54)",
  },
  obstacle: {
    accent: "#f87171",
    background: "rgba(248, 113, 113, 0.13)",
    border: "rgba(248, 113, 113, 0.54)",
  },
  output: {
    accent: "#e5e7eb",
    background: "rgba(229, 231, 235, 0.1)",
    border: "rgba(229, 231, 235, 0.42)",
  },
  parameter: {
    accent: "#d4d4d8",
    background: "rgba(212, 212, 216, 0.1)",
    border: "rgba(212, 212, 216, 0.42)",
  },
  quality: {
    accent: "#c084fc",
    background: "rgba(192, 132, 252, 0.13)",
    border: "rgba(192, 132, 252, 0.54)",
  },
  render: {
    accent: "#2dd4bf",
    background: "rgba(45, 212, 191, 0.13)",
    border: "rgba(45, 212, 191, 0.54)",
  },
  simulation: {
    accent: "#93c5fd",
    background: "rgba(147, 197, 253, 0.13)",
    border: "rgba(147, 197, 253, 0.54)",
  },
  string: {
    accent: "#e879f9",
    background: "rgba(232, 121, 249, 0.13)",
    border: "rgba(232, 121, 249, 0.54)",
  },
  transform: {
    accent: "#cbd5e1",
    background: "rgba(203, 213, 225, 0.1)",
    border: "rgba(203, 213, 225, 0.42)",
  },
  vec2: {
    accent: "#22d3ee",
    background: "rgba(34, 211, 238, 0.13)",
    border: "rgba(34, 211, 238, 0.54)",
  },
  vec3: {
    accent: "#06b6d4",
    background: "rgba(6, 182, 212, 0.13)",
    border: "rgba(6, 182, 212, 0.54)",
  },
  volume: {
    accent: "#93c5fd",
    background: "rgba(147, 197, 253, 0.13)",
    border: "rgba(147, 197, 253, 0.54)",
  },
};

export function getPortTypeTone(type: string): Tone {
  return (
    portTypeTones[type] ?? {
      accent: "var(--muted-foreground)",
      background: "var(--card)",
      border: "var(--border)",
    }
  );
}
