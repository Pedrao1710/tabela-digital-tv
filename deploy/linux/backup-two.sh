#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${TABELA_APP_DIR:?Configure TABELA_APP_DIR}"
: "${TABELA_DATA_DIR:?Configure TABELA_DATA_DIR}"
: "${RCLONE_REMOTE:?Configure RCLONE_REMOTE como destino criptografado do Google Drive}"

command -v tar >/dev/null || { echo 'tar não está instalado.' >&2; exit 1; }
command -v rclone >/dev/null || { echo 'rclone não está instalado.' >&2; exit 1; }
command -v docker >/dev/null
command -v timeout >/dev/null
command -v flock >/dev/null
[[ "$TABELA_APP_DIR" == /* && "$TABELA_APP_DIR" != / && -f "$TABELA_APP_DIR/server.mjs" && -d "$TABELA_APP_DIR/public" ]] || {
  echo 'Pasta do programa ausente ou caminho inválido; backup cancelado.' >&2
  exit 1
}
[[ "$TABELA_DATA_DIR" == /* && "$TABELA_DATA_DIR" != / && -s "$TABELA_DATA_DIR/state.json" ]] || {
  echo 'Pasta de dados ausente ou sem state.json; backup cancelado.' >&2
  exit 1
}

TABELA_APP_DIR=$(realpath -e -- "$TABELA_APP_DIR")
TABELA_DATA_DIR=$(realpath -e -- "$TABELA_DATA_DIR")
[[ "$TABELA_DATA_DIR" != "$TABELA_APP_DIR" && "$TABELA_DATA_DIR" != "$TABELA_APP_DIR/"* ]] || {
  echo 'Código e dados devem usar diretórios distintos.' >&2
  exit 1
}
container=tabela-digital
runtime_dir=${TABELA_RUNTIME_DIR:-/run/tabela-digital}
[[ "$runtime_dir" == /* && "$runtime_dir" != / && ! -L "$runtime_dir" ]] || exit 1
install -d -m 0700 -- "$runtime_dir"
exec 9>"$runtime_dir/operations.lock"
exec 8>"$runtime_dir/backup.lock"
flock -n 8 || { echo 'Outro backup do painel está em andamento.' >&2; exit 1; }
flock -n 9 || { echo 'Outra operação do painel está em andamento.' >&2; exit 1; }
[[ ! -e "$runtime_dir/maintenance" ]] || { echo 'Painel em manutenção; backup adiado.' >&2; exit 1; }

tmp=$(mktemp -d)
paused=0
maintenance_owned=0
cleanup() {
  local result=$?
  trap - EXIT
  if (( paused )); then
    if timeout 15s docker unpause "$container" >/dev/null; then
      paused=0
    else
      echo 'Não foi possível retomar tabela-digital; manutenção permanece sinalizada.' >&2
      result=1
    fi
  fi
  if (( maintenance_owned && !paused )); then
    rm -f -- "$runtime_dir/maintenance"
  fi
  rm -rf -- "$tmp"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mount_source=$(timeout 10s docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$container")
[[ -n "$mount_source" && "$(realpath -e -- "$mount_source")" == "$TABELA_DATA_DIR" ]] || {
  echo 'O diretório configurado não é o /data do container tabela-digital.' >&2
  exit 1
}
state=$(timeout 10s docker inspect --format '{{.State.Running}} {{.State.Paused}} {{index .Config.Labels "com.docker.compose.service"}}' "$container")
[[ "$state" == 'true false tabela-digital' || "$state" == 'false false tabela-digital' ]] || {
  echo 'Container incorreto ou já pausado; nenhuma pausa foi alterada.' >&2
  exit 1
}
: > "$runtime_dir/maintenance"
maintenance_owned=1
if [[ "$state" == 'true false tabela-digital' ]]; then
  # A timed-out CLI may already have paused the container. Cleanup must attempt
  # to resume it even when the pause command did not return successfully.
  paused=1
  timeout 15s docker pause "$container" >/dev/null
fi

name="tabela-digital-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
archive="$tmp/$name"
snapshot="$tmp/snapshot.tar"
roundtrip="$tmp/confirmacao.tar.gz"
remote="${RCLONE_REMOTE%/}/$name"
marker="${name%.tar.gz}.verified"

# Capture an uncompressed local snapshot while application writes are stopped.
# The pause is bounded; compression and network transfer happen after resume.
timeout 60s tar --acls --xattrs --numeric-owner -cf "$snapshot" -C / "${TABELA_APP_DIR#/}" "${TABELA_DATA_DIR#/}"
if (( paused )); then
  timeout 15s docker unpause "$container" >/dev/null
  paused=0
fi
rm -f -- "$runtime_dir/maintenance"
maintenance_owned=0
flock -u 9
exec 9>&-
gzip -c "$snapshot" > "$archive"
tar -tzf "$archive" >/dev/null
rclone copyto "$archive" "$remote"
rclone copyto "$remote" "$roundtrip"
cmp --silent "$archive" "$roundtrip" || {
  echo 'A cópia enviada não confere; backups anteriores foram preservados.' >&2
  exit 1
}
sha256sum "$archive" | cut -d ' ' -f 1 > "$tmp/$marker"
rclone copyto "$tmp/$marker" "${RCLONE_REMOTE%/}/$marker"

rclone lsf --files-only "$RCLONE_REMOTE" > "$tmp/remote-files"
mapfile -t markers < <(grep -E '^tabela-digital-[0-9TZ-]+-[0-9]+\.verified$' "$tmp/remote-files" | sort -r || true)
[[ "${markers[0]:-}" == "$marker" ]] || {
  echo 'O backup enviado não apareceu na lista remota; backups anteriores foram preservados.' >&2
  exit 1
}

for old_marker in "${markers[@]:2}"; do
  old_archive="${old_marker%.verified}.tar.gz"
  rclone deletefile "${RCLONE_REMOTE%/}/$old_marker"
  rclone deletefile "${RCLONE_REMOTE%/}/$old_archive"
done

printf 'Backup verificado: %s\nBackups mantidos: %s\n' "$name" "$((${#markers[@]} < 2 ? ${#markers[@]} : 2))"

