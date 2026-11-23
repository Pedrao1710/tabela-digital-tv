#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# This watchdog is deliberately limited to the panel's named Compose container.
container=tabela-digital
runtime_dir=${TABELA_RUNTIME_DIR:-/run/tabela-digital}
[[ "$runtime_dir" == /* && "$runtime_dir" != / && ! -L "$runtime_dir" ]] || exit 1
command -v docker >/dev/null
command -v timeout >/dev/null
command -v flock >/dev/null
install -d -m 0700 -- "$runtime_dir"
[[ ! -e "$runtime_dir/maintenance" ]] || exit 0
exec 9>"$runtime_dir/operations.lock"
flock -n 9 || exit 0
[[ ! -e "$runtime_dir/maintenance" ]] || exit 0

state=$(timeout 10s docker inspect --format '{{.State.Running}} {{.State.Paused}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{index .Config.Labels "com.docker.compose.service"}}' "$container") || {
  echo 'watchdog: não foi possível consultar o container tabela-digital.' >&2
  exit 1
}
# Do not start a stopped service, unpause maintenance, or touch another service.
[[ "$state" == 'true false unhealthy tabela-digital' ]] || exit 0

now=$(date +%s)
last=0
if [[ -r "$runtime_dir/last-restart" ]]; then
  read -r last < "$runtime_dir/last-restart" || true
fi
if [[ "$last" =~ ^[0-9]+$ ]] && (( now >= last && now - last < 300 )); then
  echo 'watchdog: falha persiste; aguardando intervalo de cinco minutos entre reinícios.' >&2
  exit 0
fi
echo 'watchdog: reiniciando exclusivamente tabela-digital após healthcheck unhealthy.' >&2
printf '%s\n' "$now" > "$runtime_dir/last-restart"
timeout 45s docker restart --time 30 "$container" >/dev/null
