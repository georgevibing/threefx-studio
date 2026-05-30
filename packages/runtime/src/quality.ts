import type { RuntimeQualityProfile } from "./types";

export const QUALITY_PROFILES: Record<RuntimeQualityProfile["id"], RuntimeQualityProfile> = {
  low: {
    id: "low",
    maxParticles: 96,
    textureSize: 64,
    simulationScale: 0.65,
  },
  medium: {
    id: "medium",
    maxParticles: 180,
    textureSize: 96,
    simulationScale: 0.85,
  },
  high: {
    id: "high",
    maxParticles: 320,
    textureSize: 128,
    simulationScale: 1,
  },
  cinematic: {
    id: "cinematic",
    maxParticles: 560,
    textureSize: 192,
    simulationScale: 1.25,
  },
};

export function resolveQualityProfile(
  quality: RuntimeQualityProfile["id"] | undefined,
): RuntimeQualityProfile {
  return QUALITY_PROFILES[quality ?? "high"];
}
