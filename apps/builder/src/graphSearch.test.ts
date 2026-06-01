import { createWispySmokeGraph } from "@threefx/core";
import { describe, expect, it } from "vitest";
import { createNodeSearchMatches, searchGraph, searchHighlightRanges } from "./graphSearch";

describe("graph search", () => {
  it("finds Curl Field through the Vorticity parameter", () => {
    const graph = createWispySmokeGraph();
    const results = searchGraph(graph, "vort");

    expect(results[0]).toMatchObject({
      fieldId: "vorticityConfinement",
      group: "Motion",
      kind: "field",
      nodeId: "curl_field",
    });

    const matches = createNodeSearchMatches(results, results[0]?.key ?? null);
    const curlMatch = matches.get("curl_field");
    expect(curlMatch?.active).toBe(true);
    expect(curlMatch?.fieldIds.has("vorticityConfinement")).toBe(true);
    expect(curlMatch?.groupIds.has("Motion")).toBe(true);
    expect(results.some((result) => result.nodeId === "output")).toBe(false);
    expect(results.some((result) => result.nodeId === "debug_view")).toBe(false);
    expect(results.some((result) => result.nodeId === "volume_render")).toBe(false);
  });

  it("finds linked source labels", () => {
    const graph = createWispySmokeGraph();
    const results = searchGraph(graph, "curl strength");

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: "curlStrength",
          kind: "field",
          nodeId: "curl_field",
        }),
      ]),
    );
  });

  it("returns no results for empty queries", () => {
    const graph = createWispySmokeGraph();

    expect(searchGraph(graph, "")).toEqual([]);
    expect(searchGraph(graph, "   ")).toEqual([]);
  });

  it("keeps equal-score result ordering deterministic", () => {
    const graph = createWispySmokeGraph();
    const first = searchGraph(graph, "render").map((result) => result.key);
    const second = searchGraph(graph, "render").map((result) => result.key);

    expect(first).toEqual(second);
  });

  it("creates deterministic group and field filter data", () => {
    const graph = createWispySmokeGraph();
    const results = searchGraph(graph, "motion");
    const matches = createNodeSearchMatches(results, null);
    const curlMatch = matches.get("curl_field");

    expect(curlMatch?.directGroupIds.has("Motion")).toBe(true);
    expect(curlMatch?.groupIds.has("Motion")).toBe(true);
    expect([...((curlMatch?.directGroupIds as Set<string> | undefined) ?? new Set())]).toEqual([
      "Motion",
    ]);
  });

  it("returns classic text highlight ranges for matching labels", () => {
    expect(searchHighlightRanges("Vorticity", "vort")).toEqual([{ start: 0, end: 4 }]);
    expect(searchHighlightRanges("Flow Warp", "fw")).toEqual([
      { start: 0, end: 1 },
      { start: 5, end: 6 },
    ]);
  });
});
