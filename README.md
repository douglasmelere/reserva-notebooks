# Reserva de Notebooks

Sistema web para reserva e gestão de **notebooks, maletas e carrinhos** em uma
instituição de ensino. Professores consultam disponibilidade e reservam
equipamentos; a supervisão administra o inventário, as reservas, as ocorrências
e os relatórios.

Roda como um container Node comum. O alvo de produção é uma **VPS da Hostinger
com Coolify** — nada aqui depende da Vercel.

---

## Sumário

- [Como funciona](#como-funciona)
- [Stack](#stack)
- [Começando](#começando)
- [Comandos](#comandos)
- [Estrutura](#estrutura)
- [Decisões de projeto](#decisões-de-projeto)
- [API](#api)
- [Testes](#testes)
- [Deploy](#deploy)

---

## Como funciona

**Professor**

1. Cria a conta com o mesmo usuário da intranet (para não decorar mais uma senha).
2. Consulta a disponibilidade por data, em visão diária, semanal ou mensal.
3. Reserva uma maleta, um carrinho, notebooks avulsos ou uma combinação.
4. Se o equipamento já estiver reservado, pode falar com o colega que está com
   ele — quando esse colega tiver autorizado contato por WhatsApp.
5. Ao devolver, confirma que ocorreu tudo bem ou registra uma ocorrência.

**Supervisão**

Cadastra e edita kits, notebooks, carregadores e usuários; acompanha o painel
com reservas do dia, devoluções pendentes e ocorrências abertas; ajusta as
regras de reserva sem precisar de um novo deploy; e consulta o histórico
completo de tudo que foi alterado.

---

## Stack

| Camada | Escolha |
|---|---|
| Framework | [vinext](https://github.com/cloudflare/vinext) 1.0.0-beta.6 — Next.js App Router rodando sobre Vite 8 |
| UI | React 19.2 · TypeScript 5.9 · Tailwind CSS 4 |
| Banco | PostgreSQL 16 |
| ORM | Prisma 7 ("Rust-free", driver adapter `@prisma/adapter-pg`) |
| Validação | Zod 4 |
| Senhas | Argon2id (`@node-rs/argon2`) |
| Testes | Vitest 4 (unidade e integração) · Playwright (ponta a ponta) |
| Empacotamento | Dockerfile multi-stage · docker-compose para desenvolvimento |

**Requisito:** Node.js **22 ou superior** (o vinext exige) e Docker para o banco.

---

## Começando

### 1. Dependências

```bash
npm install
```

> O npm 11 bloqueia scripts de instalação por padrão. Os pacotes necessários
> (`prisma`, `@prisma/engines`, `esbuild`) já estão liberados no campo
> `allowScripts` do `package.json`.

### 2. Banco de dados

```bash
docker compose up -d db
```

Sobe um PostgreSQL 16 na porta `55432` do host — porta alta de propósito, para
não colidir com um PostgreSQL já instalado na sua máquina.

### 3. Variáveis de ambiente

```bash
cp .env.example .env
```

Gere um segredo de sessão de verdade, mesmo em desenvolvimento:

```bash
openssl rand -hex 32
```

e cole em `SESSION_SECRET`.

### 4. Migrações e dados de exemplo

```bash
npm run db:migrate     # cria as tabelas e a restrição de não-sobreposição
npm run db:seed        # dados fictícios para navegar pelo sistema
```

O seed imprime as credenciais no fim. São contas de mentira, com senha pública,
e o script se recusa a rodar com `NODE_ENV=production`.

### 5. Subir

```bash
npm run dev
```

Abra <http://localhost:3000>.

> O servidor de desenvolvimento escuta em `[::1]` (IPv6). Se você usa `curl`,
> chame `http://[::1]:3000` ou `http://localhost:3000` — `127.0.0.1` não
> responde em modo dev. Em produção (`npm run start`) o bind é `0.0.0.0`.

### Primeiro supervisor em ambiente limpo

Sem seed (produção ou banco zerado), crie o supervisor explicitamente:

```bash
npm run bootstrap:admin -- --username supervisao --name "Supervisão de TI"
```

Não existe credencial administrativa embutida no código.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com recarga automática |
| `npm run build` | Gera o Prisma Client e compila para produção |
| `npm run start` | Servidor de produção (`0.0.0.0:$PORT`) |
| `npm run typecheck` | Verificação de tipos |
| `npm test` | Testes de unidade e integração |
| `npm run test:e2e` | Testes ponta a ponta (Playwright) |
| `npm run db:migrate` | Cria e aplica migração em desenvolvimento |
| `npm run db:deploy` | Aplica migrações pendentes (produção) |
| `npm run db:seed` | Popula com dados fictícios |
| `npm run db:studio` | Interface visual do banco |
| `npm run bootstrap:admin` | Cria/promove o primeiro supervisor |

### Testando o container localmente

```bash
docker compose --profile app up --build
```

Sobe a imagem de produção com o mesmo `Dockerfile` usado no Coolify — útil para
validar o build antes de publicar.

---

## Estrutura

```
app/                        Rotas (App Router)
├── (publico)/              Login e cadastro
├── (app)/                  Área autenticada do professor
├── (admin)/                Área da supervisão
└── api/                    Rotas HTTP (route handlers)

src/
├── lib/                    Infraestrutura: banco, sessão, senha, erros,
│                           auditoria, configurações, datas, armazenamento
├── server/                 Regras de negócio (não conhecem HTTP)
├── components/             Interface reutilizável
└── generated/prisma/       Client gerado (não versionado)

prisma/
├── schema.prisma           Modelo de dados
├── migrations/             Migrações versionadas
└── seed.ts                 Dados de desenvolvimento

tests/{unit,integration,e2e}
docs/deploy-coolify-hostinger.md
docker/entrypoint.sh
```

**Separação que vale conhecer:** `src/server/` contém a lógica de negócio pura e
não sabe o que é uma requisição HTTP. As rotas em `app/api/` só traduzem HTTP
para chamadas de serviço. É isso que permite testar as regras — inclusive
concorrência de reservas — sem subir servidor.

---

## Decisões de projeto

Onde a especificação deixou espaço, estas foram as escolhas. Quase todas são
ajustáveis em **Configurações**, sem novo deploy.

### Duas reservas nunca ocupam o mesmo recurso

A garantia é do banco, não do código de aplicação. Cada item de reserva carrega
o período e uma chave do recurso, e uma restrição `EXCLUDE` do PostgreSQL
(com `btree_gist`) recusa qualquer par de itens ativos do mesmo recurso cujos
intervalos se sobreponham:

```sql
EXCLUDE USING gist (
  resource_key WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (blocking)
```

Sobre isso existem mais duas camadas: um lock consultivo por recurso dentro da
transação (que serializa requisições simultâneas e permite dar uma mensagem
clara) e a consulta de disponibilidade na interface. As três são redundantes de
propósito — se a checagem da aplicação falhar, o banco ainda recusa a gravação.

O intervalo é `[início, fim)`: uma reserva que termina às 10:00 **não** conflita
com outra que começa às 10:00.

### Reservas por dia inteiro

Quando a supervisão desativa a exigência de horário, a reserva passa a cobrir
das 00:00 às 24:00 no fuso da instituição. Não existe caminho separado para
"reserva por dia": é o mesmo intervalo, só que maior — o que mantém a checagem
de conflito idêntica nos dois modos.

### Fuso horário

O banco guarda tudo em `timestamptz` (UTC). O usuário sempre informa e sempre lê
no fuso de `INSTITUTION_TIMEZONE` (padrão `America/Sao_Paulo`). A conversão
acontece em um único módulo (`src/lib/datetime.ts`).

### Sessão em banco, não JWT

O sistema precisa revogar acesso na hora: desativar uma conta ou redefinir uma
senha encerra todas as sessões daquele usuário imediatamente. Um JWT
autocontido continuaria válido até expirar. O cookie é `httpOnly`, `SameSite=Lax`
e carrega um token opaco; o banco guarda apenas o SHA-256 dele.

### Histórico é a trilha de auditoria

Em vez de uma tabela de histórico por entidade, uma única `audit_logs` registra
`entity` + `entityId` + antes/depois. Ela atende ao mesmo tempo a auditoria de
ações administrativas e o histórico de alterações de kits, notebooks, reservas e
ocorrências. Campos sensíveis são removidos antes de gravar.

### Exclusão é lógica

Kits, notebooks e usuários com histórico são **desativados**, nunca apagados —
apagar levaria junto o histórico de reservas de quem já usou o equipamento.

### WhatsApp: o número nunca sai do servidor

O botão de contato só aparece se o docente tiver telefone **e** tiver marcado a
autorização. Mesmo assim, a API devolve apenas o link `wa.me` pronto, nunca o
número — o que impede que a API seja usada como lista de telefones dos
professores. Registramos apenas o evento (quem, para quem, quando), nunca o
conteúdo da conversa. Gerar o link não altera reserva nenhuma.

### Ocorrência grave não bloqueia sozinha

Severidade alta ou crítica **sugere** marcar o equipamento como indisponível, e
a interface oferece isso em um clique — mas quem decide é a pessoa. Bloqueio
automático derrubaria aulas já agendadas sem ninguém saber.

### Rate limiting no banco

Contadores em memória se perdem no restart do container e não funcionariam com
mais de uma réplica. Como o volume de uma escola é baixo, uma tabela indexada de
tentativas resolve — e evita acrescentar Redis à topologia.

### Configurações ajustáveis pela supervisão

Antecedência mínima e máxima, reserva no mesmo dia, limite de reservas ativas,
limite de recursos por reserva, horário de funcionamento, prazo de cancelamento,
exigência de kit de carregadores completo, texto da mensagem do WhatsApp e nome
da instituição.

---

## API

Rotas em `app/api/`, respostas em JSON. Erros seguem sempre o mesmo envelope:

```json
{
  "erro": {
    "codigo": "CONFLITO_RESERVA",
    "mensagem": "Este recurso acabou de ser reservado por outra pessoa...",
    "campos": { "kitIds": ["Selecione ao menos um kit ou notebook"] },
    "detalhes": { "conflitos": [] }
  }
}
```

| Método | Rota | Perfil |
|---|---|---|
| POST | `/api/auth/register` | público |
| POST | `/api/auth/login` | público |
| POST | `/api/auth/logout` | autenticado |
| GET/PATCH | `/api/me` | autenticado |
| POST | `/api/me/password` | autenticado |
| GET | `/api/availability` | autenticado |
| GET/POST | `/api/reservations` | autenticado |
| GET/PATCH | `/api/reservations/:id` | dono ou supervisão |
| POST | `/api/reservations/:id/cancel` | dono ou supervisão |
| POST | `/api/reservations/:id/close` | dono ou supervisão |
| POST | `/api/reservations/:id/whatsapp` | autenticado |
| GET/POST | `/api/kits` · `/api/notebooks` · `/api/charger-kits` | leitura autenticada, escrita supervisão |
| GET/POST | `/api/incidents` | autenticado |
| PATCH | `/api/incidents/:id` | supervisão |
| GET | `/api/admin/dashboard` · `/api/admin/audit-logs` · `/api/admin/reports` | supervisão |
| GET/PATCH | `/api/admin/settings` | supervisão |
| GET | `/api/health` | público |

Autorização é sempre verificada **no servidor**. Esconder um botão não protege
nada: um professor que chame uma rota administrativa direto recebe `403`.

---

## Testes

```bash
# bancos de teste (uma vez)
docker exec reserva-db psql -U reserva -d postgres -c "CREATE DATABASE reserva_test OWNER reserva;"
docker exec reserva-db psql -U reserva -d postgres -c "CREATE DATABASE reserva_e2e  OWNER reserva;"
DATABASE_URL="postgresql://reserva:devpass@localhost:55432/reserva_test" npx prisma migrate deploy
DATABASE_URL="postgresql://reserva:devpass@localhost:55432/reserva_e2e"  npx prisma migrate deploy

npm test          # 149 testes de unidade e integração
npm run test:e2e  # 44 cenários ponta a ponta (desktop e celular)
```

Se o servidor de produção já estiver rodando, aponte o Playwright para ele em
vez de deixá-lo construir de novo:

```bash
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
```

Os testes de integração rodam contra um PostgreSQL **real**, e não contra um
banco simulado. O motivo é direto: a garantia mais importante do sistema depende
de uma restrição do banco e de transações. Um mock devolveria "passou"
justamente no caso que mais precisa ser testado — inclusive o de duas reservas
simultâneas disputando o mesmo equipamento.

---

## Deploy

Guia completo, passo a passo, em
**[docs/deploy-coolify-hostinger.md](docs/deploy-coolify-hostinger.md)**:
requisitos da VPS, criação do PostgreSQL, variáveis de ambiente, domínio e
HTTPS, volumes, migrações, backup, restauração, atualização e rollback.

Resumo do que o container garante:

- escuta em `0.0.0.0` na porta de `PORT`;
- `GET /api/health` confirma a aplicação **e** o acesso ao banco;
- migrações aplicadas de forma idempotente na inicialização (desligável);
- nenhum dado permanente no sistema de arquivos do container;
- logs em JSON, sem senha, token ou stack trace.

---

## Licença

Uso interno da instituição.
