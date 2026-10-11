#!/usr/bin/env python3
"""launch.py — true daemon launcher for the Wan2.1 model service.

Why does this exist?
--------------------
Some sandboxed shells kill background processes when the launching
command returns. The canonical `python server.py &` (or `nohup ... &`)
may therefore terminate the service between calls. This script
performs a classic Unix **double-fork** to fully detach the service from
its parent shell session, so it survives the launcher's exit.

Usage:
    python3 launch.py            # starts the daemon, prints "OK"
    curl http://localhost:3004/health

Stop with:
    pkill -f "python3 server.py"
"""

from __future__ import annotations

import os
import sys

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.environ.get(
    "MODEL_SERVICE_LOG", "/home/z/my-project/model-service.log"
)


def main() -> int:
    # First fork — child becomes the future daemon's parent.
    pid = os.fork()
    if pid > 0:
        # Original parent prints and exits.
        print(f"launcher: child PID={pid}; service will detach and run.")
        return 0

    # Child — become session leader (no controlling terminal).
    os.setsid()

    # Second fork — guarantee the daemon can never re-acquire a TTY.
    pid = os.fork()
    if pid > 0:
        os._exit(0)

    # Daemon — chdir, redirect fds, exec uvicorn.
    os.chdir(SERVICE_DIR)

    devnull = os.open("/dev/null", os.O_RDWR)
    log = os.open(LOG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.dup2(devnull, 0)  # stdin
    os.dup2(log, 1)      # stdout
    os.dup2(log, 2)      # stderr

    # Hand off to uvicorn via server.py's __main__.
    python = sys.executable or "python3"
    os.execvp(python, [python, "server.py"])
    return 0  # unreachable


if __name__ == "__main__":
    sys.exit(main())
