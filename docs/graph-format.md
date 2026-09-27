# Graph contract, version 2.0

`archi.model` contains the normative typed schema. `Graph.from_json(text)`
strictly checks field names, primitive types, schema version, counts,
hierarchy, relative paths, and node/edge references. The format is ordinary
UTF-8 JSON and does not require Python-specific syntax or objects. Breaking
schema changes require a new major version; the v2 reader rejects unknown
versions rather than silently interpreting them.

Every export has these fields:

| Field | Meaning |
| --- | --- |
| `schema_version` | String `"2.0"` |
| `analyzer` | String metadata map, currently name, version, language, include_type_only |
| `complete` | False if any analysis issues occurred |
| `nodes` | ID, kind, name, parent_id (nullable), root-relative path |
| `edges` | ID, kind, source ID, target ID, evidence, supporting_edges, count |
| `unresolved` | ID, source ID, reference, status, reason, evidence, candidates |
| `issues` | Code, path, message, nullable line |
| `diagnostics` | ID, rule_code, message, nodes, evidence, edge_ids, cycle |

Every field is required in serialized records; empty collections are `[]`.
`unresolved` is named for unresolved relationships, not necessarily missing
modules: its statuses are `external`, `unresolved`, and `uncertain`.

The initial node kinds are `module` and `group`; edge kinds are `imports` and
`group_dependency`. Names are labels and can use any language's notation.
Parent IDs define containment independently of name separators. Arrows point
from importer to imported node. A regular package has a group and a separate
initializer module; a namespace package is a group with no initializer.
Imports of a regular package target its initializer; namespace imports target
the group itself. The root group has no parent.

Evidence records contain `path`, one-based `line`, zero-based `column`, and
the exact statement `text` (with normalized newlines), and a required boolean
`type_only`. The boolean marks recognized type-only guards; false means not
recognized as type-only, not proof of runtime execution. Python columns use
AST UTF-8 byte offsets. Other adapters must document their column units;
no Python expression grammar is required for the text. Multiple aliases on
one statement share a site; semicolon-separated statements have different
columns. Distinct sites are identified by path, line, column, and text.

An edge's `count` is the number of distinct evidence sites, not a weight or
number of imported symbols. Direct import edges have no supporting edges.
Aggregated edges link to all underlying direct edge IDs and contain the
deduplicated union of their sites. Two targets imported by a single statement
can therefore contribute only one site to the same aggregate.

Exports contain aggregates at the immediate owning-package level.
`aggregate_dependencies(nodes, edges, depth=N)` supports other hierarchy
levels for future navigation. Root depth is zero; shallower owners stay at
their existing depth. Within-group edges disappear at the chosen level.
The cycle rule uses immediate owners. SCC diagnostics list all members and
one closed, concrete cycle with its edge IDs and supporting import sites.

The Python adapter uses root-relative POSIX paths in node IDs. Edge and
diagnostic IDs use a truncated SHA-256 of their logical identity. Evidence
changes do not change an edge's ID; membership changes change an SCC's
diagnostic ID. JSON is sorted, indented with two spaces, newline-terminated,
and escapes non-ASCII characters. It contains no timestamps, absolute root,
host information, or file enumeration order. File/name case is preserved;
case sensitivity and Unicode filename normalization follow the filesystem.
Moving an otherwise identical repository does not affect the export.

The exported data includes import statement text, but no other source
contents. The caller already knows the analyzed root; a future browser host
can provide that display context separately from the deterministic graph.

## Version 2.0 and type-only policy

Version 2.0 adds `Evidence.type_only` to import, reference, aggregate and diagnostic
sites. This is language-neutral evidence metadata; future adapters can classify
analogous dependencies. The strict reader rejects 1.0 rather than assuming its
unclassified imports are ordinary. Regenerate older snapshots with this analyzer.
Edge identity and site counts do not split by type: a mixed dependency preserves
all its sites on one edge. Site location remains path/line/column/text.

Exports always retain type-only edges and references. The analyzer metadata
`include_type_only` is `"true"` or `"false"`, recording the configured lint policy.
When false, rules filter individual sites and rebuild aggregates before checking;
diagnostic evidence contains only included sites. An edge ID in a diagnostic may
reference a mixed edge whose full exported evidence also contains excluded sites.
The browser filter does not alter exported diagnostics or the repository policy.
