import type { ParameterType, PortDefinition, PortType } from "./types";

const PARAMETER_TO_PORT: Record<ParameterType, PortType> = {
  bool: "bool",
  color: "color",
  curve: "curve",
  float: "float",
  int: "int",
  quality: "quality",
  string: "string",
  vec2: "vec2",
  vec3: "vec3",
};

export function parameterTypeToPortType(type: ParameterType): PortType {
  return PARAMETER_TO_PORT[type];
}

export function canAssignPortType(
  sourceType: PortType,
  targetType: PortType,
  acceptedTypes: readonly PortType[] = [],
): boolean {
  if (sourceType === "any" || targetType === "any") {
    return true;
  }
  if (acceptedTypes.includes(sourceType)) {
    return true;
  }
  if (sourceType === targetType) {
    return true;
  }
  if (sourceType === "int" && targetType === "float") {
    return true;
  }
  if ((sourceType === "float" || sourceType === "int") && targetType === "curve") {
    return true;
  }
  return false;
}

export function canConnectPorts(sourcePort: PortDefinition, targetPort: PortDefinition): boolean {
  if (sourcePort.direction !== "output" || targetPort.direction !== "input") {
    return false;
  }
  return canAssignPortType(sourcePort.type, targetPort.type, targetPort.acceptedTypes);
}

export function formatPortType(type: PortType): string {
  return type;
}
