export interface Site {
  path: string;
  line: number;
  column: number;
  text: string;
}
export interface GraphNode {
  id: string;
  kind: string;
  name: string;
  parent_id: string | null;
  path: string;
}
export interface Edge {
  id: string;
  kind: string;
  source: string;
  target: string;
  count: number;
  evidence: Site[];
  supporting_edges: string[];
}
export interface Diagnostic {
  id: string;
  rule_code: string;
  message: string;
  nodes: string[];
  evidence: Site[];
  edge_ids: string[];
  cycle: string[];
}
export interface Reference {
  id: string;
  source: string;
  reference: string;
  status: string;
  reason: string;
  evidence: Site;
  candidates: string[];
}
export interface Graph {
  schema_version: string;
  analyzer: Record<string, string>;
  complete: boolean;
  nodes: GraphNode[];
  edges: Edge[];
  diagnostics: Diagnostic[];
  unresolved: Reference[];
  issues: {
    code: string;
    path: string;
    message: string;
    line: number | null;
  }[];
}
export interface Project {
  name: string;
  root: string;
  version: string;
  analysis_seconds: number;
}
export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  evidence: Site[];
  underlying: Edge[];
  cyclic: boolean;
}
export interface Position {
  x: number;
  y: number;
}
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; edge: ViewEdge; returnNodeId?: string }
  | { kind: "diagnostic"; id: string }
  | { kind: "issues" }
  | { kind: "references" }
  | null;
