"""Small, strictly validated TOML configuration (RL-03, RL-04)."""

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import tomllib


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class ForbiddenRule:
    source: str
    target: str
    include_descendants: bool


@dataclass(frozen=True)
class Config:
    source_roots: tuple[str, ...] | None = None
    exclude: tuple[str, ...] = ()
    no_cycles: bool = True
    forbidden: tuple[ForbiddenRule, ...] = ()


def _relative(value: str) -> bool:
    return (bool(value) and not PurePosixPath(value).is_absolute()
            and ".." not in PurePosixPath(value).parts
            and "\\" not in value and ":" not in value)


def load_config(root: Path) -> Config:
    path = root / "pyproject.toml"
    try:
        with path.open("rb") as stream:
            data = tomllib.load(stream)
    except FileNotFoundError:
        return Config()
    except (OSError, ValueError) as exc:
        raise ConfigError(f"Cannot read pyproject.toml: {exc}") from exc
    tool = data.get("tool", {})
    if not isinstance(tool, dict):
        raise ConfigError("pyproject.toml: tool must be a table")
    table = tool.get("archi", {})
    if not isinstance(table, dict):
        raise ConfigError("tool.archi must be a table")
    unknown = set(table) - {"source-roots", "exclude", "no-cycles", "forbidden"}
    if unknown:
        raise ConfigError(f"Unknown tool.archi keys: {', '.join(sorted(unknown))}")
    for key in ("source-roots", "exclude"):
        if key in table:
            values = table[key]
            if (not isinstance(values, list) or
                    any(not isinstance(v, str) or not _relative(v) for v in values)):
                raise ConfigError(f"tool.archi.{key} must be an array of relative POSIX paths/patterns")
    roots = table.get("source-roots")
    if roots is not None:
        if not roots:
            raise ConfigError("source-roots must contain at least one directory")
        roots = tuple(sorted({PurePosixPath(v).as_posix() for v in roots}))
        for value in roots:
            candidate = root / value
            if (not candidate.is_dir() or candidate.is_symlink() or
                    not candidate.resolve().is_relative_to(root.resolve()) or
                    any(p.is_symlink() for p in candidate.parents if p != root)):
                raise ConfigError(f"source-roots entry must be a real directory inside the target: {value}")
    no_cycles = table.get("no-cycles", True)
    if type(no_cycles) is not bool:
        raise ConfigError("no-cycles must be a boolean")
    rules = table.get("forbidden", [])
    if not isinstance(rules, list):
        raise ConfigError("forbidden must be an array of tables")
    forbidden = []
    for rule in rules:
        if not isinstance(rule, dict) or set(rule) != {"from", "to", "include-descendants"}:
            raise ConfigError("Each forbidden rule needs exactly from, to, include-descendants")
        if any(not isinstance(rule[k], str) or not rule[k].strip() for k in ("from", "to")):
            raise ConfigError("Forbidden from/to must be nonempty package names")
        if type(rule["include-descendants"]) is not bool:
            raise ConfigError("include-descendants must be a boolean")
        forbidden.append(ForbiddenRule(rule["from"], rule["to"], rule["include-descendants"]))
    return Config(roots, tuple(sorted(set(table.get("exclude", [])))), no_cycles,
                  tuple(sorted(set(forbidden), key=lambda r: (r.source, r.target, r.include_descendants))))
