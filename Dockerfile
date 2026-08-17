# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Imagem de produção do sistema de reserva de notebooks.
#
# Alvo: container Node comum, gerenciado pelo Coolify em uma VPS da Hostinger.
# Nada aqui depende da Vercel, de Edge Runtime ou de qualquer API de plataforma.
#
# Estágios:
#   deps     — dependências completas (precisa das de desenvolvimento p/ build)
#   builder  — gera o Prisma Client e compila com `vinext build`
#   prod-deps— apenas dependências de produção, para a imagem final ficar enxuta
#   runner   — imagem final, sem código-fonte e sem toolchain de build
# ---------------------------------------------------------------------------

# Debian slim (glibc) e não Alpine (musl): o @node-rs/argon2 distribui binários
# pré-compilados para as duas, mas a variante glibc é a mais testada e evita
# recompilação na instalação.
ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Só os manifestos primeiro: enquanto eles não mudarem, o Docker reaproveita
# esta camada e o `npm ci` não roda de novo a cada alteração de código.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Valores de fachada, apenas para satisfazer a validação de configuração
# durante o build. Nenhum segredo real entra na imagem: os valores de verdade
# chegam em runtime, pelo Coolify. Nem `prisma generate` nem o build abrem
# conexão com o banco — o `prisma.config.ts` só exige que a variável exista.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    SESSION_SECRET="build-time-placeholder-not-used-at-runtime-000000"

# O Prisma 7 gera o client como TypeScript em src/generated/prisma, então
# precisa rodar ANTES do build — o bundler o inclui na saída.
RUN npx prisma generate

RUN npm run build

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
# `--omit=dev` deixa de fora vite, typescript e afins. O CLI do vinext e o CLI
# do prisma (usado nas migrações) são dependências de produção justamente por
# serem necessários em runtime.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# `openssl` silencia o aviso de detecção de libssl emitido pelo CLI do Prisma
# durante as migrações — ruído desnecessário no log do Coolify.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Roda como usuário sem privilégios. A imagem node já traz o usuário `node`.
RUN mkdir -p /data/uploads && chown -R node:node /data

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder  --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./

# Os scripts operacionais (criar o primeiro supervisor, limpeza periódica,
# seed) rodam com `tsx` DENTRO do container e importam de `src/` pelo alias
# "@/". Sem o código-fonte e sem o tsconfig que define o alias, esses comandos
# falham no terminal do Coolify — e criar o primeiro supervisor é justamente um
# passo obrigatório do deploy. São arquivos de texto, com peso desprezível.
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

# Depois de `src`, para que o client gerado no build sempre prevaleça sobre
# qualquer resquício vindo do contexto.
COPY --from=builder --chown=node:node /app/src/generated ./src/generated
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

USER node
EXPOSE 3000

# O health check do próprio Docker usa o mesmo endpoint que o Coolify consulta.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# `vinext start` escuta em 0.0.0.0 na porta de $PORT — exatamente o que o
# proxy reverso do Coolify espera encontrar.
CMD ["npm", "run", "start"]
