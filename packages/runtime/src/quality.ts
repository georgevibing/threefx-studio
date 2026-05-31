import type { RuntimeQualityProfile } from "./types";

export const QUALITY_PROFILES: Record<RuntimeQualityProfile["id"], RuntimeQualityProfile> = {
  low: {
    id: "low",
    maxParticles: 64,
    maxRaySteps: 48,
    shadowSteps: 4,
    volumeGrid: [32, 32, 32],
    textureSize: 64,
    simulationScale: 0.65,
  },
  medium: {
    id: "medium",
    maxParticles: 96,
    maxRaySteps: 64,
    shadowSteps: 6,
    volumeGrid: [48, 48, 48],
    textureSize: 96,
    simulationScale: 0.85,
  },
  high: {
    id: "high",
    maxParticles: 128,
    maxRaySteps: 80,
    shadowSteps: 8,
    volumeGrid: [64, 64, 64],
    textureSize: 128,
    simulationScale: 1,
  },
  cinematic: {
    id: "cinematic",
    maxParticles: 160,
    maxRaySteps: 112,
    shadowSteps: 14,
    volumeGrid: [96, 96, 96],
    textureSize: 192,
    simulationScale: 1.25,
  },
};

export function resolveQualityProfile(
  quality: RuntimeQualityProfile["id"] | undefined,
): RuntimeQualityProfile {
  return QUALITY_PROFILES[quality ?? "high"];
}
