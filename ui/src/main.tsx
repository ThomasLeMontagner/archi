import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ancestors,
  EDGE_LIMIT,
  edgePath,
  indexGraph,
  layout,
  PAGE_SIZE,
  projectEdges,
} from "./graph";
import type { Index } from "./graph";
import type {
  Camera,
  Diagnostic,
  Edge,
  Graph,
  GraphNode,
  Project,
  Selection,
  Site,
  ViewEdge,
} from "./types";
import "./style.css";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    folder: <path d="M3 6h7l2 3h9v11H3Z" />,
    module: (
      <>
        <path d="M6 3h8l4 4v14H6Z" />
        <path d="M14 3v5h5M9 12h6M9 16h6" />
      </>
    ),
    cycle: (
      <>
        <path d="M19 8a8 8 0 0 0-13-2L3 9m0-6v6h6M5 16a8 8 0 0 0 13 2l3-3m0 6v-6h-6" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    fit: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        <rect x="8" y="8" width="8" height="8" rx="1" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    layers: (
      <>
        <path d="m12 3 10 6-10 6L2 9ZM2 14l10 6 10-6" />
      </>
    ),
    warning: (
      <>
        <path d="m12 3 10 18H2Z" />
        <path d="M12 9v5m0 3v1" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    focus: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M12 1v6m0 10v6M1 12h6m10 0h6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.module}
    </svg>
  );
}

function Paged<T>({
  items,
  label,
  render,
  pageSize = 25,
  list = false,
}: {
  items: T[];
  label: string;
  render: (item: T, i: number) => React.ReactNode;
  pageSize?: number;
  list?: boolean;
}) {
  const Pagination = list ? "li" : "div";
  const [page, setPage] = useState(0);
  const count = Math.ceil(items.length / pageSize);
  const safe = Math.min(page, Math.max(0, count - 1));
  return (
    <>
      {items
        .slice(safe * pageSize, (safe + 1) * pageSize)
        .map((item, i) => render(item, i + safe * pageSize))}
      {count > 1 && (
        <Pagination className="pagination">
          <button
            aria-label={`Previous ${label}`}
            disabled={!safe}
            onClick={() => setPage(safe - 1)}
          >
            Previous
          </button>
          <span>
            {safe + 1} / {count}
          </span>
          <button
            aria-label={`Next ${label}`}
            disabled={safe + 1 >= count}
            onClick={() => setPage(safe + 1)}
          >
            Next
          </button>
        </Pagination>
      )}
    </>
  );
}

function Sites({ sites }: { sites: Site[] }) {
  return (
    <div className="evidence-list">
      <Paged
        items={sites}
        label="import sites"
        render={(s, i) => (
          <article className="evidence" key={i}>
            <div className="evidence-location">
              <Icon name="module" size={14} />
              <span>
                {s.path}:{s.line}
              </span>
            </div>
            <pre>
              <code>{s.text}</code>
            </pre>
          </article>
        )}
      />
    </div>
  );
}

function Search({
  index,
  close,
  select,
}: {
  index: Index;
  close: () => void;
  select: (node: GraphNode) => void;
}) {
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(
    () =>
      [...index.nodes.values()]
        .filter(
          (n) =>
            n.id !== index.root &&
            (n.name.toLowerCase().includes(query.toLowerCase()) ||
              n.path.toLowerCase().includes(query.toLowerCase())),
        )
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
        ),
    [index, query],
  );
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="search-dialog"
      aria-labelledby="search-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="search-inner">
        <div className="search-heading">
          <h2 id="search-title">Find a package or module</h2>
          <button
            className="icon-button"
            aria-label="Close search"
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="search-field">
          <Icon name="search" />
          <input
            ref={input}
            aria-label="Search packages and modules"
            value={query}
            placeholder="Search by name or path…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                dialog.current
                  ?.querySelector<HTMLButtonElement>(".search-result")
                  ?.focus();
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <p className="small muted" role="status">
          {matches.length} results
          {matches.length > 50
            ? " · Showing the first 50. Keep typing to narrow your search."
            : ""}
        </p>
        <div className="search-results">
          {matches.slice(0, 50).map((n) => (
            <button
              className="search-result"
              key={n.id}
              onClick={() => select(n)}
            >
              <Icon name={n.kind === "group" ? "folder" : "module"} />
              <span>
                <strong>{n.name}</strong>
                <small>{n.path}</small>
              </span>
              <span className="result-kind">
                {n.kind === "group" ? "Package" : "Module"}
              </span>
            </button>
          ))}
        </div>
        {!matches.length && (
          <p className="empty-text">
            No matching modules. Try a shorter name or part of a file path.
          </p>
        )}
      </div>
    </dialog>
  );
}

function Explorer({ graph, project }: { graph: Graph; project: Project }) {
  const index = useMemo(() => indexGraph(graph), [graph]);
  const [scope, setScope] = useState(index.root);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [search, setSearch] = useState(false);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 700, height: 500 });
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [restoreCamera, setRestoreCamera] = useState<Camera | null>(null);
  const [history, setHistory] = useState<
    { scope: string; page: number; selection: Selection; camera: Camera }[]
  >([]);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; camera: Camera } | null>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const selectedDiagnostic =
    selection?.kind === "diagnostic"
      ? graph.diagnostics.find((d) => d.id === selection.id)
      : null;
  const children = useMemo(() => {
    const candidates = index.children.get(scope) ?? [];
    if (!selectedDiagnostic) return candidates;
    const affectedAncestors = new Set(
      selectedDiagnostic.nodes.flatMap((id) => ancestors(id, index)),
    );
    return candidates.filter((n) => affectedAncestors.has(n.id));
  }, [index, scope, selectedDiagnostic]);
  const pageSize = size.width < 720 ? 4 : PAGE_SIZE;
  const visible = useMemo(
    () => children.slice(page * pageSize, (page + 1) * pageSize),
    [children, page, pageSize],
  );
  const allEdges = useMemo(
    () => projectEdges(index, scope, visible),
    [index, scope, visible],
  );
  const edges = allEdges.slice(0, EDGE_LIMIT);
  const geometry = useMemo(
    () => layout(visible, allEdges, size.width < 720 ? 2 : 3),
    [visible, allEdges, size.width < 720],
  );
  const cycles = graph.diagnostics.filter((d) => d.rule_code === "no-cycles");
  const top = index.children.get(index.root) ?? [];
  const groups = graph.nodes.filter(
    (n) => n.kind === "group" && n.id !== index.root,
  );
  const chain = ancestors(scope, index);
  const selectedId = selection?.kind === "node" ? selection.id : null;
  const emphasized = new Set(
    selectedDiagnostic?.edge_ids.flatMap((id) =>
      index.edgeMap.get(id)?.supporting_edges.length
        ? index.edgeMap.get(id)!.supporting_edges
        : [id],
    ) ?? [],
  );
  const cycleGroups = useMemo(
    () => new Set([...index.cycleNodes].flatMap((id) => ancestors(id, index))),
    [index],
  );
  const label = (id: string) =>
    id === index.root ? project.name : (index.nodes.get(id)?.name ?? id);

  function fit() {
    const zoom = Math.min(
      1.15,
      Math.max(
        0.12,
        Math.min(
          (size.width - 48) / geometry.width,
          (size.height - 70) / geometry.height,
        ),
      ),
    );
    setCamera({
      x: (size.width - geometry.width * zoom) / 2,
      y: (size.height - geometry.height * zoom) / 2,
      zoom,
    });
  }
  function focus(id: string) {
    const position = geometry.positions.get(id);
    if (!position) return;
    const zoom = Math.min(1.15, size.width / 350);
    setCamera({
      x: size.width / 2 - (position.x + 109) * zoom,
      y: size.height / 2 - (position.y + 52) * zoom,
      zoom,
    });
  }
  function zoomBy(multiplier: number, x = size.width / 2, y = size.height / 2) {
    setCamera((previous) => {
      const zoom = Math.max(0.12, Math.min(2.5, previous.zoom * multiplier));
      return {
        zoom,
        x: x - ((x - previous.x) * zoom) / previous.zoom,
        y: y - ((y - previous.y) * zoom) / previous.zoom,
      };
    });
  }
  function navigate(id: string) {
    if (id === scope) return;
    setHistory((h) => [...h, { scope, page, selection, camera }]);
    setScope(id);
    setPage(0);
    setSelection({ kind: "node", id });
  }
  function back() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setScope(previous.scope);
    setPage(previous.page);
    setSelection(previous.selection);
    setRestoreCamera(previous.camera);
  }
  function reveal(node: GraphNode) {
    const parent = node.parent_id ?? index.root;
    const siblings = index.children.get(parent) ?? [];
    setHistory((h) => [...h, { scope, page, selection, camera }]);
    setScope(parent);
    setPage(
      Math.max(
        0,
        Math.floor(siblings.findIndex((n) => n.id === node.id) / pageSize),
      ),
    );
    setSelection({ kind: "node", id: node.id });
    setPendingFocus(node.id);
    setSearch(false);
  }
  function closeSearch() {
    setSearch(false);
    requestAnimationFrame(() => searchButton.current?.focus());
  }
  function showDiagnostic(diagnostic: Diagnostic) {
    const paths = diagnostic.nodes.map((id) =>
      ancestors(id, index).slice(0, -1),
    );
    const common =
      paths[0]
        ?.filter((id) => paths.every((path) => path.includes(id)))
        .at(-1) ?? index.root;
    if (scope !== common) navigate(common);
    setPage(0);
    setSelection({ kind: "diagnostic", id: diagnostic.id });
  }
  const fromEdge = (edge: Edge): ViewEdge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    evidence: edge.evidence,
    underlying: [edge],
    cyclic: index.cycleEdges.has(edge.id),
  });

  useLayoutEffect(() => {
    const element = surface.current!;
    const observer = new ResizeObserver((entries) =>
      setSize({
        width: entries[0].contentRect.width,
        height: entries[0].contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const rect = surface.current!.getBoundingClientRect();
    if (rect.width !== size.width || rect.height !== size.height) {
      setSize({ width: rect.width, height: rect.height });
    }
  });
  useLayoutEffect(() => {
    fit();
  }, [scope, page, size.width, size.height, selectedDiagnostic?.id]);
  useEffect(() => {
    setPage((previous) =>
      Math.min(
        previous,
        Math.max(0, Math.ceil(children.length / pageSize) - 1),
      ),
    );
  }, [children.length, pageSize]);
  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const frame = requestAnimationFrame(() => {
      focus(pendingFocus);
      document
        .getElementById(`node-${pendingFocus}`)
        ?.focus({ preventScroll: true });
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus, geometry, size.width, size.height]);
  useLayoutEffect(() => {
    if (!restoreCamera) return;
    const frame = requestAnimationFrame(() => {
      setCamera(restoreCamera);
      setRestoreCamera(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [restoreCamera, size.width, size.height]);
  useEffect(() => {
    const element = surface.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomBy(
        Math.exp(-event.deltaY * 0.002),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [size]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    document.title = `${project.name} · Archi`;
  }, [project]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => performance.mark("archi-interactive")),
    );
    return () => cancelAnimationFrame(frame);
  }, []);

  function details() {
    if (selection?.kind === "edge") {
      const edge = selection.edge;
      return (
        <>
          <p className="eyebrow">Dependency</p>
          <h2 id="inspector-title">
            {label(edge.source)} <span className="direction">→</span>{" "}
            {label(edge.target)}
          </h2>
          <div className="detail-metrics">
            <strong>{edge.evidence.length}</strong>
            <span>
              distinct import {edge.evidence.length === 1 ? "site" : "sites"}
            </span>
            <span className="badge">
              {edge.underlying.length} module{" "}
              {edge.underlying.length === 1 ? "edge" : "edges"}
            </span>
          </div>
          <p className="muted small">
            Arrow points from the importing module to its dependency.
          </p>
          <h3>Underlying dependencies</h3>
          <div className="dependency-list">
            <Paged
              items={edge.underlying}
              label="dependencies"
              pageSize={15}
              render={(e) => (
                <button
                  key={e.id}
                  className="dependency-row"
                  onClick={() =>
                    setSelection({ kind: "edge", edge: fromEdge(e) })
                  }
                  aria-label={`Inspect module dependency ${label(e.source)} to ${label(e.target)}`}
                >
                  <span>
                    {label(e.source)}
                    <span className="direction"> → </span>
                    {label(e.target)}
                  </span>
                  <small>
                    {e.count} {e.count === 1 ? "site" : "sites"}
                  </small>
                </button>
              )}
            />
          </div>
          <h3>Import evidence</h3>
          <Sites key={edge.id} sites={edge.evidence} />
        </>
      );
    }
    if (selectedDiagnostic) {
      const d = selectedDiagnostic;
      return (
        <>
          <p className="eyebrow warning-text">Rule violation</p>
          <h2 id="inspector-title">
            {d.rule_code === "no-cycles"
              ? "Package dependency cycle"
              : "Forbidden dependency"}
          </h2>
          <code className="rule-code">{d.rule_code}</code>
          <p>{d.message}</p>
          <h3>Affected nodes</h3>
          <div className="member-list">
            <Paged
              items={d.nodes}
              label="affected nodes"
              render={(id) => (
                <button key={id} onClick={() => reveal(index.nodes.get(id)!)}>
                  {label(id)} <Icon name="arrow" size={14} />
                </button>
              )}
            />
          </div>
          {!!d.cycle.length && (
            <>
              <h3>Concrete cycle</h3>
              <ol className="cycle-route">
                <Paged
                  items={d.cycle}
                  label="cycle steps"
                  list
                  render={(id, i) => (
                    <li key={i}>
                      <span>{i + 1}</span>
                      {label(id)}
                    </li>
                  )}
                />
              </ol>
            </>
          )}
          <h3>Supporting imports</h3>
          <Sites key={d.id} sites={d.evidence} />
          <details className="diagnostic-id">
            <summary>Diagnostic ID</summary>
            <code>{d.id}</code>
          </details>
        </>
      );
    }
    if (selection?.kind === "issues")
      return (
        <>
          <p className="eyebrow warning-text">Analysis status</p>
          <h2 id="inspector-title">
            {graph.complete ? "Analysis complete" : "Analysis incomplete"}
          </h2>
          <p className="muted">
            Valid files remain explorable. Fix the reported files and run Archi
            again to update this snapshot.
          </p>
          {graph.issues.map((issue, i) => (
            <article className="issue" key={i}>
              <strong>
                {issue.path}
                {issue.line ? `:${issue.line}` : ""}
              </strong>
              <code>{issue.code}</code>
              <p>{issue.message}</p>
            </article>
          ))}
        </>
      );
    if (selection?.kind === "references")
      return (
        <>
          <p className="eyebrow">Resolution details</p>
          <h2 id="inspector-title">External & uncertain imports</h2>
          <p className="muted small">
            These references are preserved separately. Only confirmed local
            dependencies become arrows.
          </p>
          <Paged
            items={graph.unresolved}
            label="references"
            render={(ref) => (
              <article className="issue" key={ref.id}>
                <span className="badge">{ref.status}</span>
                <strong>{ref.reference}</strong>
                <p className="small muted">{ref.reason}</p>
                <Sites sites={[ref.evidence]} />
              </article>
            )}
          />
        </>
      );
    if (selection?.kind === "node") {
      const node = index.nodes.get(selection.id)!;
      const contained = new Set(
        graph.nodes
          .filter((n) => ancestors(n.id, index).includes(node.id))
          .map((n) => n.id),
      );
      const outgoing = index.edges.filter(
        (e) => contained.has(e.source) && !contained.has(e.target),
      );
      const incoming = index.edges.filter(
        (e) => !contained.has(e.source) && contained.has(e.target),
      );
      const refs = graph.unresolved.filter((r) => contained.has(r.source));
      return (
        <>
          <p className="eyebrow">
            {node.kind === "group" ? "Package" : "Module"}
          </p>
          <h2 id="inspector-title">{label(node.id)}</h2>
          <p className="file-path">{node.path}</p>
          <div className="node-facts">
            <span>
              <strong>{index.counts.get(node.id)}</strong> modules
            </span>
            <span>
              <strong>{outgoing.length}</strong> outgoing
            </span>
            <span>
              <strong>{incoming.length}</strong> incoming
            </span>
          </div>
          {node.kind === "group" && node.id !== scope && (
            <button className="primary full" onClick={() => navigate(node.id)}>
              <Icon name="layers" />
              Expand package
            </button>
          )}
          {geometry.positions.has(node.id) && (
            <button className="secondary full" onClick={() => focus(node.id)}>
              <Icon name="focus" />
              Focus on map
            </button>
          )}
          <h3>Outgoing dependencies</h3>
          {!outgoing.length && (
            <p className="small muted">
              No confirmed dependencies outside this{" "}
              {node.kind === "group" ? "package" : "module"}.
            </p>
          )}
          <div className="dependency-list">
            <Paged
              items={outgoing}
              label="outgoing dependencies"
              render={(e) => (
                <button
                  className="dependency-row"
                  key={e.id}
                  onClick={() =>
                    setSelection({ kind: "edge", edge: fromEdge(e) })
                  }
                >
                  <span>{label(e.target)}</span>
                  <small>
                    {e.count} {e.count === 1 ? "site" : "sites"}
                  </small>
                </button>
              )}
            />
          </div>
          {!!incoming.length && (
            <>
              <h3>Imported by</h3>
              <div className="dependency-list">
                <Paged
                  items={incoming}
                  label="incoming dependencies"
                  render={(e) => (
                    <button
                      className="dependency-row"
                      key={e.id}
                      onClick={() =>
                        setSelection({ kind: "edge", edge: fromEdge(e) })
                      }
                    >
                      <span>{label(e.source)}</span>
                      <small>
                        {e.count} {e.count === 1 ? "site" : "sites"}
                      </small>
                    </button>
                  )}
                />
              </div>
            </>
          )}
          {!!refs.length && (
            <>
              <h3>Unresolved & external references</h3>
              <Paged
                items={refs}
                label="node references"
                render={(r) => (
                  <article className="issue" key={r.id}>
                    <span className="badge">{r.status}</span>
                    <strong>{r.reference}</strong>
                    <p className="small muted">{r.reason}</p>
                    <Sites sites={[r.evidence]} />
                  </article>
                )}
              />
            </>
          )}
        </>
      );
    }
    return (
      <>
        <p className="eyebrow">Your repository, at a glance</p>
        <h2 id="inspector-title">Follow the dependencies.</h2>
        <p className="muted">
          Select a package to see what it contains. Select an arrow to trace a
          dependency to the imports that created it.
        </p>
        <div className="overview-illustration" aria-hidden="true">
          <span>
            <Icon name="folder" size={26} />
          </span>
          <i>→</i>
          <span>
            <Icon name="module" size={26} />
          </span>
        </div>
        <h3>Largest groupings</h3>
        <div className="ranking">
          {top.slice(0, 5).map((node, i) => (
            <button
              key={node.id}
              onClick={() => {
                setSelection({ kind: "node", id: node.id });
                if (visible.some((n) => n.id === node.id)) focus(node.id);
              }}
            >
              <span className="rank">0{i + 1}</span>
              <span>{node.name}</span>
              <strong>{index.counts.get(node.id)}</strong>
            </button>
          ))}
        </div>
        <h3>Analysis snapshot</h3>
        <dl className="snapshot">
          <dt>Analyzer</dt>
          <dd>{graph.analyzer.name}</dd>
          <dt>Duration</dt>
          <dd>{project.analysis_seconds.toFixed(2)} s</dd>
          <dt>Graph version</dt>
          <dd>{graph.schema_version}</dd>
        </dl>
        <button
          className="reference-link"
          onClick={() => setSelection({ kind: "references" })}
        >
          {graph.unresolved.length} external or uncertain references{" "}
          <Icon name="arrow" size={16} />
        </button>
        <p className="small muted">
          Everything stays on this computer. This view uses static imports and
          never runs repository code.
        </p>
      </>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#graph-surface">
        Skip to architecture map
      </a>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Archi home">
          <img src="/favicon.svg" alt="" width="32" height="32" />
          <span>
            archi<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="header-divider" />
        <div className="repository-label">
          <Icon name="folder" />
          <strong>{project.name}</strong>
          <span className="local-pill">
            <i />
            Local workspace
          </span>
        </div>
        <button
          ref={searchButton}
          className="search-trigger"
          onClick={() => setSearch(true)}
        >
          <Icon name="search" />
          <span>Find a module…</span>
          <kbd>⌘ / Ctrl K</kbd>
        </button>
        <a
          className="export-button"
          href="/api/graph"
          download={`${project.name}-architecture.json`}
        >
          <Icon name="download" />
          <span>Export JSON</span>
        </a>
      </header>
      <div className="workspace">
        <aside className="sidebar" aria-label="Repository navigation">
          <div className="sidebar-heading">
            <span className="eyebrow">Workspace</span>
            <span className="badge">{graph.analyzer.language ?? "Source"}</span>
          </div>
          <button
            className={`nav-overview ${scope === index.root ? "active" : ""}`}
            onClick={() => {
              navigate(index.root);
              setSelection(null);
            }}
          >
            <Icon name="layers" />
            Architecture
          </button>
          <div className="sidebar-section">
            <h2>
              Packages <span>{groups.length}</span>
            </h2>
            <div className="package-list">
              {top
                .filter((n) => n.kind === "group")
                .slice(0, 20)
                .map((n) => (
                  <button
                    key={n.id}
                    className={scope === n.id ? "current" : ""}
                    onClick={() => navigate(n.id)}
                    title={n.name}
                  >
                    <Icon name="folder" size={16} />
                    <span>{n.name}</span>
                    <small>{index.counts.get(n.id)}</small>
                  </button>
                ))}
            </div>
            {top.length > 20 && (
              <button className="text-button" onClick={() => setSearch(true)}>
                Find more packages
              </button>
            )}
          </div>
          <div className="sidebar-section diagnostics">
            <h2>
              Rule checks{" "}
              <span className={graph.diagnostics.length ? "warning-text" : ""}>
                {graph.diagnostics.length}
              </span>
            </h2>
            {!graph.diagnostics.length ? (
              <div className="checks-pass">
                <span>✓</span> No rule violations
              </div>
            ) : (
              <Paged
                items={graph.diagnostics}
                label="rule violations"
                pageSize={8}
                render={(d, i) => (
                  <button
                    key={d.id}
                    className={`diagnostic-button ${selectedDiagnostic?.id === d.id ? "selected" : ""}`}
                    onClick={() => showDiagnostic(d)}
                  >
                    <Icon
                      name={d.rule_code === "no-cycles" ? "cycle" : "warning"}
                      size={17}
                    />
                    <span>
                      <strong>
                        {d.rule_code === "no-cycles"
                          ? `Cycle ${i + 1}`
                          : "Forbidden dependency"}
                      </strong>
                      <small>
                        {d.nodes.slice(0, 3).map(label).join(" ↔ ")}
                        {d.nodes.length > 3
                          ? ` +${d.nodes.length - 3} more`
                          : ""}
                      </small>
                    </span>
                    <span className="diagnostic-count">{d.nodes.length}</span>
                  </button>
                )}
              />
            )}
          </div>
          <div className="sidebar-footer">
            <span className="status-dot" />
            Local analysis · v{project.version}
            <p title={project.root}>{project.root}</p>
          </div>
        </aside>
        <main className="main-content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">Explore your codebase</p>
              <h1>Architecture map</h1>
              <p className="muted">
                See the structure. Understand the connections.
              </p>
            </div>
            <div className="stats">
              <div>
                <strong>
                  {graph.nodes.filter((n) => n.kind === "module").length}
                </strong>
                <span>Modules</span>
              </div>
              <div>
                <strong>{groups.length}</strong>
                <span>Packages</span>
              </div>
              <button
                className={cycles.length ? "cycle-stat" : ""}
                onClick={() =>
                  cycles.length ? showDiagnostic(cycles[0]) : setSelection(null)
                }
                aria-label={`${cycles.length} package cycles`}
              >
                <strong>{cycles.length}</strong>
                <span>Cycles</span>
              </button>
            </div>
          </section>
          {!graph.complete && (
            <div className="incomplete-banner" role="alert">
              <Icon name="warning" />
              <span>
                <strong>Analysis incomplete.</strong> {graph.issues.length} file
                or discovery {graph.issues.length === 1 ? "issue" : "issues"};
                valid results are shown.
              </span>
              <button onClick={() => setSelection({ kind: "issues" })}>
                View issues
              </button>
            </div>
          )}
          <section className="map-panel" aria-label="Architecture view">
            <div className="map-heading">
              <div className="breadcrumbs">
                <button
                  className="icon-button"
                  onClick={back}
                  disabled={!history.length}
                  aria-label="Back to previous view"
                >
                  <Icon name="back" size={17} />
                </button>
                <nav aria-label="Package breadcrumb">
                  {chain.map((id, i) => (
                    <React.Fragment key={id}>
                      {i > 0 && <span className="breadcrumb-separator">/</span>}
                      <button
                        aria-current={id === scope ? "location" : undefined}
                        onClick={() => navigate(id)}
                      >
                        {label(id)}
                      </button>
                    </React.Fragment>
                  ))}
                </nav>
              </div>
              <span className="view-label">
                {selectedDiagnostic
                  ? "Violation focus"
                  : scope === index.root
                    ? "Package overview"
                    : "Inside package"}
              </span>
            </div>
            {children.length > pageSize && (
              <div className="bounded-notice">
                <span>
                  Showing {page * pageSize + 1}–
                  {Math.min(children.length, (page + 1) * pageSize)} of{" "}
                  {children.length}. Search to reveal any module.
                </span>
                <button
                  aria-label="Previous map page"
                  disabled={page === 0}
                  onClick={() => {
                    setPage(page - 1);
                    setSelection(null);
                  }}
                >
                  ←
                </button>
                <button
                  aria-label="Next map page"
                  disabled={(page + 1) * pageSize >= children.length}
                  onClick={() => {
                    setPage(page + 1);
                    setSelection(null);
                  }}
                >
                  →
                </button>
              </div>
            )}
            <div
              ref={surface}
              id="graph-surface"
              className="graph-surface"
              tabIndex={0}
              role="region"
              aria-label="Dependency map. Drag to pan, scroll to zoom. Arrow keys pan; plus and minus zoom; F fits the view."
              onPointerDown={(e) => {
                if (
                  (e.target as Element).closest('button, [role="button"], a') ||
                  e.button !== 0
                )
                  return;
                drag.current = { x: e.clientX, y: e.clientY, camera };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (drag.current)
                  setCamera({
                    ...drag.current.camera,
                    x: drag.current.camera.x + e.clientX - drag.current.x,
                    y: drag.current.camera.y + e.clientY - drag.current.y,
                  });
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [60, 0],
                  ArrowRight: [-60, 0],
                  ArrowUp: [0, 60],
                  ArrowDown: [0, -60],
                };
                if (moves[e.key]) {
                  e.preventDefault();
                  const [x, y] = moves[e.key];
                  setCamera((c) => ({ ...c, x: c.x + x, y: c.y + y }));
                } else if (["+", "=", "-", "f", "F"].includes(e.key)) {
                  e.preventDefault();
                  if (e.key.toLowerCase() === "f") fit();
                  else zoomBy(e.key === "-" ? 0.8 : 1.25);
                }
              }}
            >
              <div className="map-legend">
                <span>
                  <i className="legend-line" />
                  Import direction
                </span>
                {!!cycles.length && (
                  <span>
                    <i className="legend-line cycle" />
                    Cycle
                  </span>
                )}
              </div>
              <div
                className="graph-world"
                data-testid="graph-world"
                style={{
                  width: geometry.width,
                  height: geometry.height,
                  transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
                }}
              >
                <svg
                  className="graph-edges"
                  width={geometry.width}
                  height={geometry.height}
                  aria-label="Dependency arrows"
                >
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#6d8882" />
                    </marker>
                    <marker
                      id="cycle-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#b64d2c" />
                    </marker>
                  </defs>
                  {edges.map((edge) => {
                    const a = geometry.positions.get(edge.source)!,
                      b = geometry.positions.get(edge.target)!;
                    const route = edgePath(
                      a,
                      b,
                      allEdges.some(
                        (other) =>
                          other.source === edge.target &&
                          other.target === edge.source,
                      ),
                    );
                    const active =
                      (selection?.kind === "edge" &&
                        selection.edge.id === edge.id) ||
                      edge.underlying.some((e) => emphasized.has(e.id));
                    return (
                      <g
                        key={edge.id}
                        className={`graph-edge ${edge.cyclic ? "cyclic" : ""} ${active ? "selected" : ""}`}
                        onClick={() => setSelection({ kind: "edge", edge })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelection({ kind: "edge", edge });
                          }
                        }}
                      >
                        <path className="edge-hit" d={route.path} />
                        <path
                          className="edge-line"
                          d={route.path}
                          markerEnd={
                            edge.cyclic ? "url(#cycle-arrow)" : "url(#arrow)"
                          }
                        />
                        <g
                          role="button"
                          tabIndex={0}
                          className="edge-label"
                          aria-label={`Dependency ${label(edge.source)} to ${label(edge.target)}, ${edge.evidence.length} import sites`}
                        >
                          <rect
                            x={route.x - 16}
                            y={route.y - 12}
                            width="32"
                            height="24"
                            rx="8"
                          />
                          <text x={route.x} y={route.y + 4} textAnchor="middle">
                            {edge.evidence.length}
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </svg>
                {visible.map((node) => {
                  const position = geometry.positions.get(node.id)!;
                  const cyclic =
                    cycleGroups.has(node.id) ||
                    ancestors(node.id, index).some((id) =>
                      index.cycleNodes.has(id),
                    );
                  const title =
                    node.kind === "group"
                      ? node.name.split(".").at(-1)
                      : node.path.split("/").at(-1);
                  return (
                    <div
                      key={node.id}
                      className={`graph-node ${selectedId === node.id ? "selected" : ""} ${cyclic ? "in-cycle" : ""}`}
                      style={{ left: position.x, top: position.y }}
                    >
                      <button
                        id={`node-${node.id}`}
                        className="node-select"
                        title={`${node.name}\n${node.path}`}
                        aria-label={`Select ${node.kind === "group" ? "package" : "module"} ${node.name}`}
                        aria-pressed={selectedId === node.id}
                        onClick={() =>
                          setSelection({ kind: "node", id: node.id })
                        }
                        onDoubleClick={() =>
                          node.kind === "group" && navigate(node.id)
                        }
                      >
                        <div className="node-top">
                          <span className={`node-icon ${node.kind}`}>
                            <Icon
                              name={node.kind === "group" ? "folder" : "module"}
                            />
                          </span>
                          <span className="node-kind">
                            {node.kind === "group" ? "PACKAGE" : "MODULE"}
                          </span>
                          {cyclic && (
                            <span
                              className="cycle-mark"
                              title="Participates in a package cycle"
                            >
                              <Icon name="cycle" size={15} />
                            </span>
                          )}
                        </div>
                        <strong>{title}</strong>
                        <small>
                          {node.kind === "group"
                            ? `${index.counts.get(node.id)} ${index.counts.get(node.id) === 1 ? "module" : "modules"}`
                            : node.name}
                        </small>
                      </button>
                      {node.kind === "group" && (
                        <button
                          className="node-expand"
                          aria-label={`Expand package ${node.name}`}
                          onClick={() => navigate(node.id)}
                        >
                          <Icon name="arrow" size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {!visible.length && (
                <div className="map-empty">
                  <Icon name="layers" size={36} />
                  <h2>
                    {graph.nodes.some((n) => n.kind === "module")
                      ? "No child modules in this group"
                      : "No Python modules found"}
                  </h2>
                  <p>
                    Check the selected directory and configured source roots.
                  </p>
                </div>
              )}
              <div className="map-tools">
                <button
                  className="icon-button"
                  aria-label="Zoom out"
                  onClick={() => zoomBy(0.8)}
                >
                  −
                </button>
                <output aria-label="Zoom level">
                  {Math.round(camera.zoom * 100)}%
                </output>
                <button
                  className="icon-button"
                  aria-label="Zoom in"
                  onClick={() => zoomBy(1.25)}
                >
                  +
                </button>
                <span />
                <button
                  className="icon-button"
                  aria-label="Fit map to view"
                  onClick={fit}
                >
                  <Icon name="fit" />
                </button>
                <button
                  className="icon-button"
                  aria-label="Focus selected node"
                  disabled={!selectedId || !geometry.positions.has(selectedId)}
                  onClick={() => selectedId && focus(selectedId)}
                >
                  <Icon name="focus" />
                </button>
              </div>
              <span className="map-hint">Drag to pan · Scroll to zoom</span>
            </div>
            <div className="map-footer">
              <span>
                {visible.length} visible nodes · {edges.length} connections
                within this view
                {allEdges.length > EDGE_LIMIT
                  ? ` (${allEdges.length - EDGE_LIMIT} hidden; inspect a node for all dependencies)`
                  : ""}
              </span>
              <button onClick={() => setSelection({ kind: "references" })}>
                Resolution details <Icon name="arrow" size={13} />
              </button>
            </div>
          </section>
        </main>
        <aside className="inspector" aria-labelledby="inspector-title">
          <div className="inspector-top">
            <span className="eyebrow">Inspector</span>
            {selection && (
              <button
                className="icon-button"
                aria-label="Clear selection"
                onClick={() => setSelection(null)}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
          <div
            className="inspector-content"
            tabIndex={0}
            key={
              selection?.kind === "node"
                ? selection.id
                : selection?.kind === "edge"
                  ? selection.edge.id
                  : selection?.kind === "diagnostic"
                    ? selection.id
                    : (selection?.kind ?? "overview")
            }
          >
            {details()}
          </div>
        </aside>
      </div>
      <p className="sr-only" role="status">
        {selection?.kind === "node"
          ? `Selected ${label(selection.id)}`
          : selection?.kind === "edge"
            ? `Inspecting dependency ${label(selection.edge.source)} to ${label(selection.edge.target)}`
            : selectedDiagnostic
              ? selectedDiagnostic.message
              : ""}
      </p>
      {search && <Search index={index} close={closeSearch} select={reveal} />}
    </div>
  );
}

function App() {
  const [data, setData] = useState<{ graph: Graph; project: Project } | null>(
    null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    async function load() {
      try {
        const [g, p] = await Promise.all([
          fetch("/api/graph"),
          fetch("/api/project"),
        ]);
        if (!g.ok || !p.ok)
          throw new Error(
            "The local analysis server could not return this snapshot.",
          );
        const graph = (await g.json()) as Graph;
        if (graph.schema_version !== "1.0")
          throw new Error(
            "This graph version is not supported by the explorer.",
          );
        const project = await p.json();
        performance.mark("archi-data-ready");
        setData({ graph, project });
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Unable to load analysis.",
        );
      }
    }
    void load();
  }, []);
  if (error)
    return (
      <main className="loading-screen">
        <Icon name="warning" size={36} />
        <h1>Unable to open this analysis</h1>
        <p role="alert">{error}</p>
        <p>Make sure Archi is still running, then reload this page.</p>
        <button className="primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  if (!data)
    return (
      <main className="loading-screen">
        <img src="/favicon.svg" width="48" height="48" alt="" />
        <h1>Opening your architecture</h1>
        <p role="status">Loading the local analysis snapshot…</p>
      </main>
    );
  return <Explorer {...data} />;
}
createRoot(document.getElementById("root")!).render(<App />);
