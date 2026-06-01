import {
  defaultNodeRegistry,
  getParameterNodeValueType,
  type GraphDocument,
  type GraphNode,
  type NodeDefinition,
} from "@threefx/core";
import {
  editableInputEntries,
  resolveNodeInputBindings,
  type NodeParameterEntry,
} from "./nodeParameterModel";

export type GraphSearchResultKind = "field" | "group" | "node";

export type GraphSearchResult = {
  readonly fieldId?: string;
  readonly group?: string;
  readonly key: string;
  readonly kind: GraphSearchResultKind;
  readonly label: string;
  readonly nodeId: string;
  readonly nodeIndex: number;
  readonly score: number;
};

export type NodeSearchMatchView = {
  readonly active: boolean;
  readonly directGroupIds: ReadonlySet<string>;
  readonly fieldIds: ReadonlySet<string>;
  readonly groupIds: ReadonlySet<string>;
  readonly nodeMatched: boolean;
};

export type SearchHighlightRange = {
  readonly end: number;
  readonly start: number;
};

type TextCandidate = {
  readonly text: string | null | undefined;
  readonly weight: number;
};

type DraftSearchResult = GraphSearchResult & {
  readonly resultIndex: number;
};

const KIND_RANK: Record<GraphSearchResultKind, number> = {
  field: 0,
  group: 1,
  node: 2,
};
const ORDERED_SUBSEQUENCE_MAX_SCORE = 230;

export function searchGraph(graph: GraphDocument, query: string): readonly GraphSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  const results: DraftSearchResult[] = [];
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    const definition = defaultNodeRegistry.get(node.type);
    if (!definition) {
      continue;
    }
    const inputBindings = resolveNodeInputBindings(graph, node);
    const entries = editableInputEntries(node, definition, graph.parameters, inputBindings);
    const nodeScore = bestCandidateScore(normalizedQuery, nodeCandidates(node, definition, entries));
    if (nodeScore > 0) {
      results.push({
        key: `node:${node.id}`,
        kind: "node",
        label: node.label,
        nodeId: node.id,
        nodeIndex,
        resultIndex: results.length,
        score: nodeScore,
      });
    }

    for (const group of uniqueParameterGroups(entries)) {
      const groupScore = bestCandidateScore(normalizedQuery, [{ text: group, weight: 88 }]);
      if (groupScore <= 0) {
        continue;
      }
      results.push({
        group,
        key: `group:${node.id}:${group}`,
        kind: "group",
        label: `${node.label} / ${group}`,
        nodeId: node.id,
        nodeIndex,
        resultIndex: results.length,
        score: groupScore,
      });
    }

    for (const entry of entries) {
      const fieldScore = bestCandidateScore(normalizedQuery, fieldCandidates(entry));
      if (fieldScore <= 0) {
        continue;
      }
      const group = entry.metadata.group || "Parameters";
      results.push({
        fieldId: entry.metadata.id,
        group,
        key: `field:${node.id}:${entry.metadata.id}`,
        kind: "field",
        label: `${node.label} / ${group} / ${entry.metadata.label}`,
        nodeId: node.id,
        nodeIndex,
        resultIndex: results.length,
        score: fieldScore,
      });
    }
  }

  return results
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.nodeIndex - right.nodeIndex ||
        KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
        left.label.localeCompare(right.label) ||
        left.resultIndex - right.resultIndex,
    )
    .map(({ resultIndex: _resultIndex, ...result }) => result);
}

export function createNodeSearchMatches(
  results: readonly GraphSearchResult[],
  activeResultKey: string | null,
): ReadonlyMap<string, NodeSearchMatchView> {
  type MutableMatch = {
    active: boolean;
    directGroupIds: Set<string>;
    fieldIds: Set<string>;
    groupIds: Set<string>;
    nodeMatched: boolean;
  };
  const matches = new Map<string, MutableMatch>();
  const matchForNode = (nodeId: string): MutableMatch => {
    const existing = matches.get(nodeId);
    if (existing) {
      return existing;
    }
    const next: MutableMatch = {
      active: false,
      directGroupIds: new Set(),
      fieldIds: new Set(),
      groupIds: new Set(),
      nodeMatched: false,
    };
    matches.set(nodeId, next);
    return next;
  };

  for (const result of results) {
    const match = matchForNode(result.nodeId);
    match.active = match.active || result.key === activeResultKey;
    if (result.kind === "node") {
      match.nodeMatched = true;
      continue;
    }
    if (result.group) {
      match.groupIds.add(result.group);
    }
    if (result.kind === "group" && result.group) {
      match.directGroupIds.add(result.group);
    }
    if (result.kind === "field" && result.fieldId) {
      match.fieldIds.add(result.fieldId);
    }
  }

  return matches;
}

export function searchHighlightRanges(text: string, query: string): readonly SearchHighlightRange[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!text || !normalizedQuery) {
    return [];
  }

  const lowerText = text.toLowerCase();
  const directIndex = lowerText.indexOf(normalizedQuery);
  if (directIndex >= 0) {
    return [{ start: directIndex, end: directIndex + normalizedQuery.length }];
  }

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  if (!compactQuery) {
    return [];
  }

  const tokenPrefixRange = tokenPrefixHighlightRange(text, compactQuery);
  if (tokenPrefixRange) {
    return [tokenPrefixRange];
  }

  const acronymRanges = acronymHighlightRanges(text, compactQuery);
  if (acronymRanges.length > 0) {
    return acronymRanges;
  }

  return orderedCharacterHighlightRanges(text, compactQuery);
}

function nodeCandidates(
  node: GraphNode,
  definition: NodeDefinition,
  entries: readonly NodeParameterEntry[],
): TextCandidate[] {
  const parameterType = getParameterNodeValueType(node.type);
  return [
    { text: node.label, weight: 104 },
    { text: definition.label, weight: 98 },
    { text: definition.category, weight: 82 },
    { text: definition.type, weight: 80 },
    { text: definition.kind, weight: 76 },
    { text: definition.description, weight: 66 },
    { text: parameterType, weight: 72 },
    ...definition.ports.flatMap((port) => [
      { text: port.label, weight: 58 },
      { text: port.id, weight: 54 },
      { text: port.type, weight: 48 },
      { text: port.description, weight: 42 },
    ]),
    ...entries.map((entry) => ({
      text: entry.binding?.sourceLabel,
      weight: 46,
    })),
  ];
}

function fieldCandidates(entry: NodeParameterEntry): TextCandidate[] {
  return [
    { text: entry.metadata.label, weight: 112 },
    { text: entry.metadata.id, weight: 102 },
    { text: entry.metadata.group, weight: 74 },
    { text: entry.metadata.description, weight: 78 },
    { text: entry.metadata.type, weight: 58 },
    { text: entry.metadata.unit, weight: 46 },
    { text: entry.port.label, weight: 96 },
    { text: entry.port.id, weight: 84 },
    { text: entry.port.description, weight: 64 },
    { text: entry.binding?.sourceLabel, weight: 96 },
    { text: entry.binding?.sourceNode?.label, weight: 92 },
    { text: entry.binding?.sourcePort?.label, weight: 54 },
    ...(entry.metadata.options ?? []).map((option) => ({ text: option, weight: 50 })),
  ];
}

function uniqueParameterGroups(entries: readonly NodeParameterEntry[]): string[] {
  const groups: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const group = entry.metadata.group || "Parameters";
    if (seen.has(group)) {
      continue;
    }
    seen.add(group);
    groups.push(group);
  }
  return groups;
}

function bestCandidateScore(query: string, candidates: readonly TextCandidate[]): number {
  let best = 0;
  for (const candidate of candidates) {
    const score = candidateScore(query, candidate);
    if (score > best) {
      best = score;
    }
  }
  return best;
}

function candidateScore(query: string, candidate: TextCandidate): number {
  const text = normalizeSearchText(candidate.text ?? "");
  if (!text) {
    return 0;
  }
  const baseScore = fuzzyScore(query, text);
  if (baseScore > 0 && baseScore <= ORDERED_SUBSEQUENCE_MAX_SCORE && text.length > 24) {
    return 0;
  }
  return baseScore > 0 ? baseScore + candidate.weight : 0;
}

function fuzzyScore(query: string, text: string): number {
  if (text === query) {
    return 500;
  }
  if (text.startsWith(query)) {
    return 430 - Math.min(text.length - query.length, 80);
  }
  const tokenPrefixScore = tokenPrefixMatchScore(query, text);
  if (tokenPrefixScore > 0) {
    return tokenPrefixScore;
  }
  const substringIndex = text.indexOf(query);
  if (substringIndex >= 0) {
    return 360 - Math.min(substringIndex, 80) - Math.min(text.length - query.length, 80);
  }
  const acronymScore = acronymMatchScore(query, text);
  if (acronymScore > 0) {
    return acronymScore;
  }
  return orderedSubsequenceScore(query, text);
}

function tokenPrefixMatchScore(query: string, text: string): number {
  const tokens = text.split(" ").filter(Boolean);
  const tokenIndex = tokens.findIndex((token) => token.startsWith(query));
  if (tokenIndex < 0) {
    return 0;
  }
  return 400 - tokenIndex * 12 - Math.min(tokens[tokenIndex]?.length ?? 0, 60);
}

function acronymMatchScore(query: string, text: string): number {
  const acronym = text
    .split(" ")
    .filter(Boolean)
    .map((token) => token[0])
    .join("");
  if (!acronym || !acronym.startsWith(query)) {
    return 0;
  }
  return 340 - Math.min(acronym.length - query.length, 40);
}

function orderedSubsequenceScore(query: string, text: string): number {
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  let gapPenalty = 0;
  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (text[textIndex] !== query[queryIndex]) {
      continue;
    }
    if (firstMatch < 0) {
      firstMatch = textIndex;
    }
    if (lastMatch >= 0) {
      gapPenalty += Math.max(0, textIndex - lastMatch - 1);
    }
    lastMatch = textIndex;
    queryIndex += 1;
  }
  if (queryIndex !== query.length || firstMatch < 0 || lastMatch < 0) {
    return 0;
  }
  const span = lastMatch - firstMatch + 1;
  const maxSpan = query.length * 3;
  if (span > maxSpan || gapPenalty > query.length * 2) {
    return 0;
  }
  return Math.max(
    1,
    ORDERED_SUBSEQUENCE_MAX_SCORE - firstMatch * 3 - span * 2 - gapPenalty * 4,
  );
}

function normalizeSearchText(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function tokenPrefixHighlightRange(text: string, compactQuery: string): SearchHighlightRange | null {
  for (const token of text.matchAll(/[A-Za-z0-9]+/g)) {
    const source = token[0];
    if (!source.toLowerCase().startsWith(compactQuery)) {
      continue;
    }
    return { start: token.index, end: token.index + compactQuery.length };
  }
  return null;
}

function acronymHighlightRanges(
  text: string,
  compactQuery: string,
): readonly SearchHighlightRange[] {
  const tokens = [...text.matchAll(/[A-Za-z0-9]+/g)];
  if (compactQuery.length > tokens.length) {
    return [];
  }
  const ranges: SearchHighlightRange[] = [];
  for (let index = 0; index < compactQuery.length; index += 1) {
    const token = tokens[index];
    if (!token || token[0].charAt(0).toLowerCase() !== compactQuery.charAt(index)) {
      return [];
    }
    ranges.push({ start: token.index, end: token.index + 1 });
  }
  return ranges;
}

function orderedCharacterHighlightRanges(
  text: string,
  compactQuery: string,
): readonly SearchHighlightRange[] {
  const ranges: SearchHighlightRange[] = [];
  const lowerText = text.toLowerCase();
  let queryIndex = 0;
  for (let textIndex = 0; textIndex < lowerText.length && queryIndex < compactQuery.length; textIndex += 1) {
    if (lowerText.charAt(textIndex) !== compactQuery.charAt(queryIndex)) {
      continue;
    }
    ranges.push({ start: textIndex, end: textIndex + 1 });
    queryIndex += 1;
  }
  return queryIndex === compactQuery.length ? mergeAdjacentRanges(ranges) : [];
}

function mergeAdjacentRanges(ranges: readonly SearchHighlightRange[]): readonly SearchHighlightRange[] {
  const merged: SearchHighlightRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && previous.end === range.start) {
      merged[merged.length - 1] = { start: previous.start, end: range.end };
    } else {
      merged.push(range);
    }
  }
  return merged;
}
