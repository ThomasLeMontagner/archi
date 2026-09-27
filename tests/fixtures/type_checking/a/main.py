from typing import TYPE_CHECKING
import typing as t
from typing import TYPE_CHECKING as TC

if TYPE_CHECKING:
    import b.peer
    from . import helper
    import missing_vendor
    if enabled:
        import c.peer
else:
    import c.peer
if t.TYPE_CHECKING:
    import b.peer
if TC:
    import b.peer
import c.peer
