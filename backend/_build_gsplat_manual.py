from __future__ import annotations

import subprocess
import sys
from pathlib import Path
import re

from jobs import _ns_env


BUILD_DIR = Path.cwd() / ".cache" / "torch_extensions" / "gsplat_cuda"
NINJA = Path(r"C:\Users\Neha5\nerfstudio_env\Scripts\ninja.exe")
LOG = Path.cwd() / "gsplat_manual_build.log"


def log(message: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(message + "\n")
    print(message, flush=True)


def main() -> int:
    env = _ns_env()
    LOG.write_text("", encoding="utf-8")

    if not BUILD_DIR.exists():
        log(f"missing build dir: {BUILD_DIR}")
        return 1

    cmd_result = subprocess.run(
        [str(NINJA), "-n", "-v", "gsplat_cuda.pyd"],
        capture_output=True,
        text=True,
        check=False,
        cwd=BUILD_DIR,
        env=env,
    )
    if cmd_result.returncode != 0:
        log(f"ninja -t commands failed: {cmd_result.stderr.strip()}")
        return cmd_result.returncode

    commands = []
    for line in cmd_result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        line = re.sub(r"^\[\d+/\d+\]\s+", "", line)
        commands.append(line)
    total = len(commands)
    log(f"resolved {total} remaining build commands")

    for idx, command in enumerate(commands, start=1):
        log(f"[{idx}/{total}] start")
        result = subprocess.run(
            command,
            cwd=BUILD_DIR,
            env=env,
            text=True,
            capture_output=True,
            check=False,
            shell=True,
        )
        if result.stdout:
            log(result.stdout[-4000:])
        if result.stderr:
            log(result.stderr[-4000:])
        if result.returncode != 0:
            log(f"[{idx}/{total}] failed with {result.returncode}")
            return result.returncode
        log(f"[{idx}/{total}] done")

    pyd = BUILD_DIR / "gsplat_cuda.pyd"
    log(f"finished, pyd exists={pyd.exists()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
