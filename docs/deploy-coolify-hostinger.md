# Deploy no Coolify (VPS Hostinger)

Guia completo para colocar o sistema em produção em uma VPS da Hostinger
gerenciada pelo [Coolify](https://coolify.io). Nenhuma etapa depende da Vercel.

A aplicação é um container Node comum: ela escuta em `0.0.0.0` na porta indicada
por `PORT`, expõe `GET /api/health` e não guarda nada permanente no sistema de
arquivos do próprio container.

---

## 1. Requisitos da VPS

| Item | Mínimo | Recomendado |
|---|---|---|
| vCPU | 2 | 2–4 |
| Memória | 4 GB | 8 GB |
| Disco | 40 GB SSD | 80 GB SSD |
| Sistema | Ubuntu 22.04/24.04 LTS | Ubuntu 24.04 LTS |

Por que 4 GB é o piso: o Coolify, o PostgreSQL, o build da aplicação e o próprio
Docker convivem na mesma máquina. O build do Vite é a parte mais pesada — em uma
VPS de 2 GB ele costuma ser morto pelo OOM killer. Se a sua VPS for pequena,
veja a seção *Build fora da VPS* no fim deste documento.

Antes de começar:

- domínio (ou subdomínio) apontando para o IP da VPS, via registro `A`;
- portas 80 e 443 liberadas no firewall;
- Coolify instalado e acessível no painel.

---

## 2. Criar o PostgreSQL no Coolify

1. No projeto do Coolify: **+ New** → **Database** → **PostgreSQL**.
2. Versão **16** (ou superior).
3. Defina nome do banco, usuário e uma senha forte.
4. **Não** publique a porta 5432 para a internet. Deixe o banco acessível apenas
   pela rede interna do Docker — é assim que a aplicação vai falar com ele.
5. Anote a **URL interna de conexão**. O Coolify a exibe em algo como:

   ```
   postgresql://USUARIO:SENHA@NOME-DO-SERVICO:5432/NOME-DO-BANCO
   ```

   O hostname é o nome do serviço na rede interna, **não** o IP público.

> **Extensão necessária.** A migração inicial executa
> `CREATE EXTENSION IF NOT EXISTS btree_gist;`. Ela faz parte do pacote
> `postgresql-contrib`, presente na imagem oficial do PostgreSQL usada pelo
> Coolify — não é preciso instalar nada. O usuário do banco precisa ter
> permissão para criar extensões (o usuário dono do banco, criado pelo Coolify,
> tem).

---

## 3. Criar a aplicação

1. **+ New** → **Application** → **Public/Private Repository**.
2. Conecte o repositório Git (GitHub, GitLab ou Git genérico) e escolha o branch.
3. **Build Pack: Dockerfile.** O repositório já traz um `Dockerfile` multi-stage
   pronto; não use Nixpacks.
4. **Port Exposes: 3000.**
5. Em **Health Check**, configure:
   - Path: `/api/health`
   - Port: `3000`
   - Interval: `30s` · Timeout: `5s` · Retries: `3`
   - Start period: `40s` (o container aplica migrações antes de subir)

---

## 4. Variáveis de ambiente

Em **Environment Variables**, marque como *Build Variable* apenas quando indicado.
Todo o resto é de runtime.

### Obrigatórias

```bash
NODE_ENV=production

# URL interna do PostgreSQL criado no passo 2
DATABASE_URL=postgresql://USUARIO:SENHA@NOME-DO-SERVICO:5432/NOME-DO-BANCO?schema=public

# Domínio público, com https
APP_URL=https://reservas.suaescola.edu.br

# Gere o SEU. A aplicação recusa subir com um valor de exemplo.
#   openssl rand -hex 32
SESSION_SECRET=<64 caracteres hexadecimais aleatórios>
```

### Recomendadas

```bash
PORT=3000
INSTITUTION_TIMEZONE=America/Sao_Paulo
SESSION_TTL_HOURS=12
COOKIE_SECURE=auto          # com HTTPS, resolve para true
RUN_MIGRATIONS=true
RUN_SEED=false              # NUNCA true em produção
LOGIN_MAX_ATTEMPTS=8
LOGIN_WINDOW_MINUTES=15
```

### Anexos das ocorrências

**Opção A — S3 (recomendada).** Os arquivos ficam fora do container, então
trocar de imagem, escalar réplicas ou refazer o deploy não perde nada.

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
S3_REGION=us-east-1
S3_BUCKET=reserva-notebooks
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false   # true para MinIO e compatíveis
```

Funciona com qualquer serviço compatível com S3: AWS, MinIO auto-hospedado,
Backblaze B2, Cloudflare R2 ou o Object Storage da própria Hostinger.

**Opção B — volume persistente.**

```bash
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=/data/uploads
```

Se escolher esta, **você precisa declarar o volume** (passo 6). Sem o volume,
os anexos são apagados no próximo deploy.

### Bootstrap do primeiro supervisor

Defina temporariamente, rode o comando do passo 8 e **remova depois**:

```bash
BOOTSTRAP_ADMIN_USERNAME=supervisao
BOOTSTRAP_ADMIN_PASSWORD=<senha forte, mínimo 12 caracteres>
BOOTSTRAP_ADMIN_NAME=Supervisão de TI
```

---

## 5. Domínio e HTTPS

1. Em **Domains**, informe `https://reservas.suaescola.edu.br`.
2. O Coolify configura o proxy reverso (Traefik ou Caddy) e emite o certificado
   Let's Encrypt automaticamente. Confirme que o DNS já propagou antes — a
   emissão falha se o domínio ainda não resolver para a VPS.
3. Ative **Force HTTPS**.
4. Confirme que `APP_URL` é exatamente a mesma URL, com `https://`. Ela é usada
   para validar a origem das requisições; um valor divergente faz mutações
   legítimas serem recusadas.

---

## 6. Volume persistente (apenas com `STORAGE_DRIVER=local`)

Em **Storages** → **Add**:

- Name: `uploads`
- Destination Path: `/data/uploads`

O diretório já é criado no `Dockerfile` com dono `node`, então o container
consegue escrever nele.

---

## 7. Primeiro deploy

Clique em **Deploy** e acompanhe os logs. A sequência esperada:

```
{"nivel":"info","contexto":"entrypoint","mensagem":"aplicando migracoes do banco"}
...
{"nivel":"info","contexto":"entrypoint","mensagem":"migracoes aplicadas"}
{"nivel":"info","contexto":"entrypoint","mensagem":"iniciando aplicacao na porta 3000"}
  vinext start
  ➜  Local: http://0.0.0.0:3000/
```

Valide de fora:

```bash
curl -s https://reservas.suaescola.edu.br/api/health
# {"status":"ok","database":"ok","uptimeSeconds":12,...}
```

`"database":"erro"` com HTTP 503 significa que a aplicação subiu mas não alcança
o banco: revise a `DATABASE_URL` e confirme que os dois recursos estão na mesma
rede interna do Coolify.

---

## 8. Criar o primeiro supervisor

O sistema não tem credencial administrativa embutida no código. O primeiro
supervisor é criado explicitamente, uma única vez.

No Coolify, abra **Terminal / Execute Command** no container da aplicação:

```bash
npm run bootstrap:admin
```

O comando lê `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` e
`BOOTSTRAP_ADMIN_NAME`. Também aceita argumentos, se você preferir não deixar a
senha em variável de ambiente:

```bash
npm run bootstrap:admin -- --username supervisao --name "Supervisão de TI"
```

O script é idempotente: rodar de novo com um usuário existente apenas o promove
a supervisor.

**Depois de criar a conta:** remova as três variáveis `BOOTSTRAP_ADMIN_*` do
Coolify e redeploy. Entre no sistema e troque a senha.

---

## 9. Migrações

O `entrypoint.sh` roda `prisma migrate deploy` a cada inicialização. O comando é
idempotente: aplica apenas o que falta e não faz nada quando o banco já está em
dia.

### Controle manual

Com mais de uma réplica, duas instâncias subindo ao mesmo tempo tentariam migrar
em paralelo. Nesse caso:

1. Defina `RUN_MIGRATIONS=false`.
2. Antes de publicar a nova versão, rode no terminal do container:

   ```bash
   npx prisma migrate deploy
   ```

### Conferir o estado

```bash
npx prisma migrate status
```

### Migração que falhou no meio

```bash
# depois de corrigir o banco manualmente:
npx prisma migrate resolve --applied <nome_da_migracao>
# ou, se ela não deve ser considerada aplicada:
npx prisma migrate resolve --rolled-back <nome_da_migracao>
```

---

## 10. Backup

### Automático pelo Coolify

No recurso PostgreSQL → **Backups**: defina a frequência (diária é o mínimo
razoável para uma escola), a retenção e, se possível, um destino S3. Backup
guardado só na mesma VPS não protege contra perda da VPS.

### Manual

```bash
# dentro do container do PostgreSQL
pg_dump -U USUARIO -d NOME-DO-BANCO -F c -f /tmp/reserva-$(date +%F).dump

# copiando para a sua máquina
docker cp CONTAINER_DO_POSTGRES:/tmp/reserva-2026-08-17.dump .
```

Se estiver usando `STORAGE_DRIVER=local`, o volume `/data/uploads` **também**
precisa entrar na rotina de backup — ele não faz parte do dump do banco.

### Restauração

```bash
# atenção: sobrescreve os dados atuais
pg_restore -U USUARIO -d NOME-DO-BANCO --clean --if-exists /tmp/reserva-2026-08-17.dump
```

Depois de restaurar, reinicie o container da aplicação para descartar o cache de
configurações em memória.

---

## 11. Atualização e rollback

### Atualizar

1. `git push` no branch configurado.
2. O Coolify constrói a nova imagem e só troca o container quando o health check
   passa. Se o build ou o health check falharem, a versão anterior continua no ar.

### Rollback

**Pelo painel:** o Coolify guarda os deployments anteriores. Em **Deployments**,
localize a versão que funcionava e clique em **Redeploy**.

**Por commit:** aponte o campo de branch/commit para o SHA anterior e faça deploy.

> **Rollback e banco de dados.** Voltar a aplicação não desfaz migrações já
> aplicadas. Se a versão nova tiver adicionado uma coluna, a versão antiga
> continua funcionando (ela simplesmente ignora a coluna). Mas se uma migração
> tiver **removido** ou **renomeado** algo, o rollback da aplicação quebra.
> Prática recomendada: migrações aditivas em um deploy, remoções apenas no
> deploy seguinte, depois de confirmar que a versão nova está estável.

---

## 12. Logs

Os logs saem em JSON de uma linha, no formato que o visualizador do Coolify
apresenta bem:

```json
{"nivel":"erro","contexto":"api","momento":"2026-08-17T18:20:11.001Z","mensagem":"..."}
```

O que **nunca** aparece nos logs, por decisão de projeto: senha, hash de senha,
token de sessão, corpo de requisição e stack trace em produção. Erros de negócio
(conflito de reserva, validação) saem como `"nivel":"aviso"`; só falhas
inesperadas saem como `"nivel":"erro"`.

---

## 13. Manutenção periódica

Sessões expiradas e tentativas de login antigas se acumulam. Crie uma
**Scheduled Task** no Coolify (semanal é suficiente):

```bash
npx tsx scripts/cleanup.ts
```

---

## 14. Segurança em produção — conferência final

- [ ] `SESSION_SECRET` gerado com `openssl rand -hex 32`, único para esta instalação
- [ ] `APP_URL` com `https://` e idêntico ao domínio configurado
- [ ] PostgreSQL **sem** porta publicada na internet
- [ ] `RUN_SEED=false`
- [ ] Variáveis `BOOTSTRAP_ADMIN_*` removidas após criar o supervisor
- [ ] Senha do primeiro supervisor trocada no primeiro acesso
- [ ] Backup automático do banco ativo e testado com uma restauração real
- [ ] Volume de uploads declarado (se `STORAGE_DRIVER=local`)
- [ ] Health check respondendo em `/api/health`
- [ ] Firewall da VPS liberando apenas 22, 80 e 443

---

## Apêndice A — Build fora da VPS

Se a VPS não der conta do build (sintoma: o deploy morre sem mensagem clara, ou
com `Killed`), construa a imagem em outro lugar e apenas publique:

```bash
# na sua máquina ou em um runner de CI
docker build -t registry.exemplo.com/reserva-notebooks:1.0.0 .
docker push registry.exemplo.com/reserva-notebooks:1.0.0
```

No Coolify, troque o tipo do recurso para **Docker Image** e informe a imagem.
As variáveis de ambiente e o health check continuam idênticos.

---

## Apêndice B — Problemas comuns

**O container reinicia em laço.**
Veja os logs. Quase sempre é `SESSION_SECRET` ausente/curto ou `DATABASE_URL`
errada — a aplicação falha rápido e com mensagem explícita nesses dois casos.

**`CREATE EXTENSION` negado na primeira migração.**
O usuário do banco não é dono dele. Conecte como superusuário e rode
`CREATE EXTENSION IF NOT EXISTS btree_gist;` uma vez, manualmente.

**Formulários retornam "origem não confiável".**
`APP_URL` não corresponde ao domínio pelo qual o usuário acessa. Corrija a
variável e faça redeploy.

**Horários aparecem deslocados.**
Confira `INSTITUTION_TIMEZONE`. O banco guarda tudo em UTC; a conversão para o
horário local acontece na aplicação, a partir dessa variável.

**Anexos somem depois do deploy.**
`STORAGE_DRIVER=local` sem volume declarado. Configure o volume (passo 6) ou
migre para S3.
