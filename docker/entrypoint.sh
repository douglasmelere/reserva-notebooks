#!/bin/sh
# ---------------------------------------------------------------------------
# Ponto de entrada do container.
#
# Aplica as migrações pendentes antes de subir a aplicação. `prisma migrate
# deploy` é idempotente: aplica só o que ainda não foi aplicado e não faz nada
# quando o banco já está em dia — então é seguro em cada deploy e em cada
# reinício do container.
#
# Se você preferir controlar as migrações manualmente (recomendado quando há
# mais de uma réplica), defina RUN_MIGRATIONS=false e rode o comando pelo
# terminal do Coolify antes de publicar a nova versão.
# ---------------------------------------------------------------------------
set -e

log() {
  printf '{"nivel":"info","contexto":"entrypoint","mensagem":"%s"}\n' "$1"
}

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  log "aplicando migracoes do banco"
  # Um `migrate deploy` que falha deve derrubar o start: subir a aplicação com
  # o schema desatualizado produziria erros piores e mais difíceis de ler.
  npx prisma migrate deploy
  log "migracoes aplicadas"
else
  log "RUN_MIGRATIONS=false — migracoes ignoradas"
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  log "executando seed de desenvolvimento"
  npm run db:seed
fi

log "iniciando aplicacao na porta ${PORT:-3000}"
exec "$@"
