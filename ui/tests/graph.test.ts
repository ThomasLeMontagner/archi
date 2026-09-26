import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { indexGraph, projectEdges, layout, PAGE_SIZE } from "../src/graph";
import type { Graph } from "../src/types";
import { packageMetrics } from "../src/metrics";

function fixture(name: string): Graph {
  const root = resolve("..");
  const result = spawnSync(
    "python3",
    ["-m", "archi", "export", `tests/fixtures/${name}`],
    {
      cwd: root,
      env: { ...process.env, PYTHONPATH: resolve(root, "src") },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("AN-04/IR-02: package projection counts distinct sites and retains all underlying edges", () => {
  const graph = fixture("aggregation"),
    index = indexGraph(graph);
  const edges = projectEdges(
    index,
    index.root,
    index.children.get(index.root)!,
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0].evidence.length, 3);
  assert.equal(edges[0].underlying.length, 3);
  assert.deepEqual(
    edges[0].evidence.map((s) => [s.path, s.line]),
    [
      ["a/one.py", 1],
      ["a/one.py", 2],
      ["a/two.py", 1],
    ],
  );
});

test("UI-02: changing context uses immediate children and suppresses internal aggregate edges", () => {
  const graph = fixture("src_layout"),
    index = indexGraph(graph);
  const children = index.children.get("group:src/acme")!;
  assert.equal(children.length, 4);
  assert(children.some((n) => n.name === "acme.nested"));
  const ids = new Set(children.map((n) => n.id));
  assert(
    projectEdges(index, "group:src/acme", children).every(
      (e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target,
    ),
  );
  const nested = index.children.get("group:src/acme/nested")!;
  assert.equal(nested.length, 3);
});

test("UI-06: cycle witnesses highlight real supporting edges, not internal imports", () => {
  const graph = fixture("cycles"),
    index = indexGraph(graph);
  const edges = projectEdges(
    index,
    index.root,
    index.children.get(index.root)!,
  );
  assert.equal(edges.filter((e) => e.cyclic).length, 5);
  assert.equal(edges.filter((e) => !e.cyclic).length, 1);
});

test("UI-01/OP-02: layout is deterministic, disjoint, and supports bounded pages", () => {
  const graph = fixture("cycles"),
    index = indexGraph(graph),
    nodes = index.children.get(index.root)!.slice(0, PAGE_SIZE);
  const edges = projectEdges(index, index.root, nodes);
  const first = layout(nodes, edges),
    second = layout(nodes, edges);
  assert.deepEqual(first, second);
  const positions = [...first.positions.values()];
  for (let i = 0; i < positions.length; i++)
    for (let j = i + 1; j < positions.length; j++) {
      assert(
        Math.abs(positions[i].x - positions[j].x) >= 218 ||
          Math.abs(positions[i].y - positions[j].y) >= 104,
      );
    }
});

test("MET-01/03: distinct package counts retain repeated import evidence", () => {
  const graph = fixture("metrics"),
    index = indexGraph(graph);
  const original = JSON.stringify(graph);
  const metrics = packageMetrics(graph, index, "group:alpha")!;
  assert.deepEqual(
    metrics.incoming.map((c) => c.node.name),
    ["delta"],
  );
  assert.deepEqual(
    metrics.outgoing.map((c) => c.node.name),
    ["beta", "gamma.deep"],
  );
  assert.equal(metrics.instability, 2 / 3);
  const beta = metrics.outgoing[0].dependency;
  assert.deepEqual(
    beta.evidence.map((s) => [s.path, s.line]),
    [
      ["alpha/main.py", 1],
      ["alpha/main.py", 2],
      ["alpha/main.py", 3],
      ["alpha/main.py", 7],
      ["alpha/nested/worker.py", 1],
    ],
  );
  assert.equal(beta.underlying.length, 4);
  assert.equal(metrics.incoming[0].dependency.source, "group:delta");
  assert.equal(metrics.incoming[0].dependency.target, "group:alpha");
  assert.equal(
    JSON.stringify(graph),
    original,
    "Metrics must not mutate graph or diagnostics",
  );
});

test("MET-01/02: subtree boundaries and endpoint cases are independent of map projection", () => {
  const graph = fixture("metrics"),
    index = indexGraph(graph);
  const alpha = packageMetrics(graph, index, "group:alpha");
  projectEdges(index, index.root, index.children.get(index.root)!.slice(0, 1));
  projectEdges(index, "group:alpha", index.children.get("group:alpha")!);
  assert.deepEqual(packageMetrics(graph, index, "group:alpha"), alpha);
  const nested = packageMetrics(graph, index, "group:alpha/nested")!;
  assert.deepEqual(
    nested.incoming.map((c) => c.node.name),
    ["alpha", "delta"],
  );
  assert.deepEqual(
    nested.outgoing.map((c) => c.node.name),
    ["beta", "gamma.deep"],
  );
  assert.equal(nested.instability, 0.5);
  assert.equal(packageMetrics(graph, index, "group:delta")!.instability, 1);
  assert.equal(packageMetrics(graph, index, "group:beta")!.instability, 0);
  assert.equal(
    packageMetrics(graph, index, "group:isolated")!.instability,
    null,
  );
  assert.equal(packageMetrics(graph, index, index.root), null);
  assert.equal(packageMetrics(graph, index, "module:alpha/main.py"), null);
});

test("MET-04: coverage includes references, root modules and incomplete analysis", () => {
  const graph = fixture("metrics"),
    index = indexGraph(graph);
  const metrics = packageMetrics(graph, index, "group:alpha")!;
  assert.deepEqual(metrics.excluded, {
    external: 1,
    uncertain: 1,
    unresolved: 1,
  });
  assert.deepEqual(
    metrics.ungroupedSites.map((s) => [s.path, s.line]),
    [
      ["alpha/main.py", 9],
      ["script.py", 1],
    ],
  );
  assert.equal(metrics.complete, true);
  assert.equal(
    packageMetrics({ ...graph, complete: false }, index, "group:alpha")!
      .complete,
    false,
  );
  const reordered = {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse(),
  };
  assert.deepEqual(
    packageMetrics(reordered, indexGraph(reordered), "group:alpha"),
    metrics,
  );
});

test("MET-01/03: mutual dependencies count once in each direction, regardless of cycle policy", () => {
  const graph = fixture("cycles");
  const index = indexGraph(graph);
  const metric = packageMetrics(graph, index, "group:a")!;
  assert.deepEqual(
    metric.incoming.map((c) => c.node.name),
    ["b"],
  );
  assert.deepEqual(
    metric.outgoing.map((c) => c.node.name),
    ["b"],
  );
  assert.equal(metric.instability, 0.5);
  const noPolicy = { ...graph, diagnostics: [] };
  assert.equal(
    packageMetrics(noPolicy, indexGraph(noPolicy), "group:a")!.instability,
    0.5,
  );
});
