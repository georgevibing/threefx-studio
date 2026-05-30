export interface Tone {
  readonly accent: string;
  readonly background: string;
  readonly border: string;
}

export const portTypeTones: Record<string, Tone> = {
  bool: { accent: "var(--muted-foreground)", background: "var(--card)", border: "var(--border)" },
  color: { accent: "var(--muted-foreground)", background: "var(--card)", border: "var(--border)" },
  emitter: { accent: "var(--foreground)", background: "var(--card)", border: "var(--border)" },
  field: { accent: "var(--muted-foreground)", background: "var(--card)", border: "var(--border)" },
  float: { accent: "var(--muted-foreground)", background: "var(--card)", border: "var(--border)" },
  force: { accent: "var(--muted-foreground)", background: "var(--card)", border: "var(--border)" },
  flow: { accent: "var(--muted-foreground)", background: "var(--card)", border: "var(--border)" },
  quality: { accent: "var(--muted-foreground)", background: "var(--card)", border: "var(--border)" },
  render: { accent: "var(--foreground)", background: "var(--card)", border: "var(--border)" },
  simulation: { accent: "var(--foreground)", background: "var(--card)", border: "var(--border)" },
  vec3: { accent: "var(--muted-foreground)", background: "var(--card)", border: "var(--border)" },
  volume: { accent: "var(--foreground)", background: "var(--card)", border: "var(--border)" },
};

export function getPortTypeTone(type: string): Tone {
  return portTypeTones[type] ?? {
    accent: "var(--muted-foreground)",
    background: "var(--card)",
    border: "var(--border)",
  };
}
