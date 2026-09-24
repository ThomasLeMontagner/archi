"""Adapters emit Graph; aggregation, rules, and serialization are shared."""

from pathlib import Path
from typing import Protocol

from archi.config import Config
from archi.model import Graph


class Analyzer(Protocol):
    def analyze(self, root: Path, config: Config) -> Graph:
        """Analyze source without executing it; return evidence and issues."""
        ...
