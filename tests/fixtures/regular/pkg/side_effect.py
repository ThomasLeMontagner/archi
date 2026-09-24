raise RuntimeError("Archi must never execute this file")
from pathlib import Path
Path("SIDE_EFFECT_OCCURRED").write_text("unsafe")
