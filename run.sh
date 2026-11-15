#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -U pip
  .venv/bin/pip install -r requirements.txt
fi

# shellcheck disable=SC1091
source .venv/bin/activate

HOST=$(python3 -c "import json; print(json.load(open('config.json')).get('host','0.0.0.0'))")
PORT=$(python3 -c "import json; print(json.load(open('config.json')).get('port',8766))")

echo "Notes Browser"
echo "  listen: http://${HOST}:${PORT}"
# 打印本机 192.168.* 与 Tailscale 100.* 访问地址
python3 - <<'PY'
import json, socket
from pathlib import Path

port = json.loads(Path("config.json").read_text()).get("port", 8766)
addrs = []
try:
    import subprocess
    out = subprocess.check_output(["ip", "-4", "-o", "addr", "show", "scope", "global"], text=True)
    for line in out.splitlines():
        parts = line.split()
        # format: N: ifname    inet 192.168.x.x/24 ...
        if "inet" in parts:
            i = parts.index("inet")
            ip = parts[i + 1].split("/")[0]
            if ip.startswith("192.168.") or ip.startswith("100."):
                addrs.append(ip)
except Exception:
    pass
if not addrs:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        addrs.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
for ip in sorted(set(addrs)):
    kind = "LAN" if ip.startswith("192.168.") else ("Tailscale" if ip.startswith("100.") else "IP")
    print(f"  {kind}: http://{ip}:{port}")
PY
echo

exec uvicorn app.main:app --host "$HOST" --port "$PORT"
