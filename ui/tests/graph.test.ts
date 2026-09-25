import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { indexGraph, projectEdges, layout, PAGE_SIZE } from "../src/graph";
import type { Graph } from "../src/types";

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
