#!/usr/bin/env bash
# Notes Browser 服务管理：./service.sh start|stop|restart|status
set -euo pipefail
cd "$(dirname "$0")"

NAME="Notes Browser"
PID_FILE=".service.pid"
LOG_FILE="service.log"
DEFAULT_PORT=12001

read_port() {
  python3 -c "import json; print(json.load(open('config.json')).get('port', ${DEFAULT_PORT}))" 2>/dev/null || echo "${DEFAULT_PORT}"
}

is_running() {
  local pid=$1
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

pid_from_file() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' < "$PID_FILE"
  fi
}

pid_from_port() {
  local port=$1
  ss -tlnp 2>/dev/null | awk -v p=":${port}" '
    $4 ~ p"$" {
      if (match($0, /pid=([0-9]+)/, m)) { print m[1]; exit }
    }'
}

cmd_status() {
  local port pid
  port=$(read_port)
  pid=$(pid_from_file)
  if is_running "${pid:-}"; then
    echo "${NAME}: running (pid ${pid}, port ${port})"
    return 0
  fi
  pid=$(pid_from_port "$port")
  if is_running "${pid:-}"; then
    echo "${NAME}: running (pid ${pid}, port ${port}, no pidfile)"
    return 0
  fi
  echo "${NAME}: stopped (port ${port})"
  return 1
}

cmd_start() {
  local port pid
  port=$(read_port)
  pid=$(pid_from_file)
  if is_running "${pid:-}"; then
    echo "${NAME}: already running (pid ${pid})"
    return 0
  fi
  pid=$(pid_from_port "$port")
  if is_running "${pid:-}"; then
    echo "${pid}" > "$PID_FILE"
    echo "${NAME}: already listening on port ${port} (pid ${pid}); wrote pidfile"
    return 0
  fi

  if [[ ! -x ./run.sh ]]; then
    chmod +x ./run.sh
  fi

  nohup ./run.sh >> "$LOG_FILE" 2>&1 &
  pid=$!
  echo "$pid" > "$PID_FILE"

  # 等待进程起来或端口就绪
  for _ in $(seq 1 30); do
    if ! is_running "$pid"; then
      echo "${NAME}: failed to start (see ${LOG_FILE})"
      rm -f "$PID_FILE"
      return 1
    fi
    if ss -tln 2>/dev/null | grep -qE "[:.]${port}\\b"; then
      echo "${NAME}: started (pid ${pid}, port ${port})"
      echo "  log: ${LOG_FILE}"
      return 0
    fi
    sleep 0.2
  done

  echo "${NAME}: started process (pid ${pid}) but port ${port} not ready yet; check ${LOG_FILE}"
  return 0
}

cmd_stop() {
  local port pid
  port=$(read_port)
  pid=$(pid_from_file)
  if ! is_running "${pid:-}"; then
    pid=$(pid_from_port "$port")
  fi

  if ! is_running "${pid:-}"; then
    rm -f "$PID_FILE"
    echo "${NAME}: already stopped"
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 25); do
    if ! is_running "$pid"; then
      rm -f "$PID_FILE"
      echo "${NAME}: stopped (was pid ${pid})"
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "${NAME}: force-stopped (pid ${pid})"
}

cmd_restart() {
  cmd_stop || true
  cmd_start
}

usage() {
  echo "Usage: $0 {start|stop|restart|status}"
  exit 1
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  *)       usage ;;
esac
