import sys
from pathlib import Path

# Support both `uvicorn agent.app.main:app` from monorepo root and
# `uvicorn app.main:app` from `agent/` (or via `--app-dir agent`).
_monorepo_root = Path(__file__).resolve().parents[2]
if (_monorepo_root / "agent" / "app").is_dir() and str(_monorepo_root) not in sys.path:
    sys.path.insert(0, str(_monorepo_root))
