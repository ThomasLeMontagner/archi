"""Small two-commit history shared by comparison acceptance and browser tests."""
from pathlib import Path
import subprocess


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def history(root: Path) -> tuple[str, str]:
    git(root, 'init', '-q')
    git(root, 'config', 'user.name', 'Archi test')
    git(root, 'config', 'user.email', 'archi@example.invalid')
    files = {
        'a/main.py': 'import b.peer\n', 'b/peer.py': 'raise RuntimeError("Repository code must not execute")\n',
        'c/peer.py': '# Leaf\n', 'removed/gone.py': '# Removed\n',
        'shift/client.py': 'import b.peer\n', 'typed/client.py': 'import b.peer\n',
        'pyproject.toml': '[tool.archi]\n',
    }
    def write(path, text):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    for path, text in files.items():
        write(path, text)
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'Base')
    base = git(root, 'rev-parse', 'HEAD')
    write('a/main.py', 'import c.peer\n')
    write('c/peer.py', 'import a.main\n')
    write('newpkg/new.py', 'import a.main\n')
    write('shift/client.py', '# Moved evidence\n\nimport b.peer\n')
    write('typed/client.py', 'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    import b.peer\n')
    (root / 'removed/gone.py').unlink()
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'Head')
    return base, git(root, 'rev-parse', 'HEAD')
