#!/usr/bin/env bash
set -u

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$here"

echo '=== Painel de TV ==='
if command -v docker >/dev/null 2>&1; then
  docker compose ps
  if docker inspect tabela-digital >/dev/null 2>&1; then
    docker inspect --format 'Container: {{.State.Status}}{{if .State.Health}} | saúde: {{.State.Health.Status}}{{end}}' tabela-digital
  fi
else
  echo 'Docker indisponível.'
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

host=${TABELA_BIND:-127.0.0.1}
port=${TABELA_PORT:-8088}
if command -v curl >/dev/null 2>&1 && curl --fail --silent --show-error --max-time 5 "http://${host}:${port}/healthz" >/dev/null; then
  echo 'Web: respondendo'
else
  echo 'Web: sem resposta'
fi

source_dir=${PRICE_SOURCE_DIR:-/mnt/tabela-precos}
for store in 001 002; do
  if [[ -r "$source_dir/Toledo/$store/txitens.txt" ]]; then
    echo "Fonte Toledo $store: leitura disponível"
  else
    echo "Fonte Toledo $store: indisponível"
  fi
done

if systemctl is-enabled --quiet tabela-backup.timer 2>/dev/null; then
  systemctl list-timers tabela-backup.timer --no-pager
  systemctl --no-pager --full status tabela-backup.service 2>/dev/null | sed -n '1,6p'
else
  echo 'Backup do painel: timer não configurado'
fi

