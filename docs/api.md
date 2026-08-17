# API

Todas as rotas ficam sob `/api`, respondem em JSON e usam UTF-8. A autenticação
é por cookie de sessão (`httpOnly`, `SameSite=Lax`), enviado automaticamente pelo
navegador — não há token em cabeçalho.

Datas e horas trafegam em **ISO 8601 UTC**. A conversão para o fuso da
instituição acontece na apresentação, nunca no transporte.

---

## Convenções

### Erros

Toda falha usa o mesmo envelope:

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

`mensagem` já vem em português e pode ir direto para a tela. `campos` aparece em
erros de validação, no formato que os formulários consomem. `detalhes` carrega
dados estruturados específicos do erro.

| Código | HTTP | Quando acontece |
|---|---|---|
| `NAO_AUTENTICADO` | 401 | Sem sessão válida, ou credenciais inválidas |
| `SEM_PERMISSAO` | 403 | Autenticado, mas sem direito à operação |
| `ORIGEM_INVALIDA` | 403 | Mutação vinda de origem não confiável |
| `NAO_ENCONTRADO` | 404 | Registro inexistente — ou existente mas fora do alcance de quem pergunta |
| `CONFLITO` | 409 | Violação de unicidade (código de kit, patrimônio) |
| `CONFLITO_RESERVA` | 409 | O recurso já está reservado no período |
| `DADOS_INVALIDOS` | 422 | Falha de validação |
| `REGRA_DE_NEGOCIO` | 422 | Operação válida na forma, proibida pela regra |
| `MUITAS_TENTATIVAS` | 429 | Rate limit de login |
| `ERRO_INTERNO` | 500 | Falha inesperada (sem detalhe técnico na resposta) |

> `NAO_ENCONTRADO` também é a resposta quando um professor tenta acessar a
> reserva de outro. Responder `SEM_PERMISSAO` confirmaria que aquele
> identificador existe.

### Autorização

Verificada **sempre no servidor**, em toda rota. Três níveis:

- **público** — `/api/health`, `/api/auth/register`, `/api/auth/login`
- **autenticado** — qualquer usuário com sessão
- **supervisão** — apenas `role = SUPERVISOR`

Rotas autenticadas que devolvem listas aplicam recorte por dono: um professor
recebe apenas os próprios registros, mesmo passando o `userId` de outra pessoa
como filtro.

### Proteção contra CSRF

Mutações (`POST`, `PATCH`, `DELETE`) validam o cabeçalho `Origin` contra
`APP_URL` e contra o host da requisição. Requisições sem `Origin` (cliente de
API, `curl`) passam — elas não são cross-site.

### Paginação

Listagens aceitam `page` (≥ 1) e `pageSize` (1–100, padrão 20) e devolvem:

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 20 }
```

---

## Autenticação

### `POST /api/auth/register` · público

Cadastro de professor. Cria sempre com perfil `PROFESSOR`.

```json
{
  "username": "prof.silva",
  "password": "senha-com-8-ou-mais",
  "fullName": "Carlos Silva",
  "email": "carlos@escola.edu.br",
  "phone": "(48) 99999-8888",
  "whatsappOptIn": true,
  "department": "Matemática"
}
```

`username` é normalizado para minúsculas. `email`, `phone`, `whatsappOptIn` e
`department` são opcionais.

### `POST /api/auth/login` · público

```json
{ "username": "prof.silva", "password": "..." }
```

Define o cookie de sessão e devolve `{ usuario, sessaoExpiraEm }`.

Credencial errada, usuário inexistente e conta desativada produzem **a mesma**
resposta `401` com a mesma mensagem — e levam o mesmo tempo para responder, para
não permitir descobrir quais contas existem.

Após 8 falhas do mesmo usuário em 15 minutos (configurável), responde `429`.

### `POST /api/auth/logout` · autenticado

Revoga a sessão no banco e limpa o cookie.

---

## Perfil

### `GET /api/me` · autenticado
### `PATCH /api/me` · autenticado

Altera nome, e-mail, telefone, departamento e o consentimento de WhatsApp.
Campos ausentes no corpo não são alterados.

### `POST /api/me/password` · autenticado

```json
{ "currentPassword": "...", "newPassword": "..." }
```

Exige a senha atual.

---

## Disponibilidade

### `GET /api/availability` · autenticado

| Parâmetro | Descrição |
|---|---|
| `date` | **obrigatório**, `AAAA-MM-DD` |
| `startTime`, `endTime` | `HH:MM`; ausentes = dia inteiro |
| `kitType` | `MALETA` ou `CARRINHO` |
| `location`, `search`, `minCapacity` | filtros |
| `includeUnavailable` | só tem efeito para a supervisão |
| `onlyStandaloneNotebooks` | apenas notebooks fora de kit |

Resposta:

```json
{
  "periodo": { "date": "2026-09-01", "startsAt": "...", "endsAt": "...", "allDay": false, "formatado": "01/09/2026, das 08:00 às 10:00" },
  "kits": [
    {
      "kind": "kit", "id": "...", "code": "MAL-001", "name": "Maleta 01",
      "type": "MALETA", "capacity": 10, "notebookCount": 10,
      "status": "DISPONIVEL", "statusLabel": "Disponível",
      "state": "RESERVADO",
      "chargerKit": { "totalQuantity": 10, "availableQuantity": 10, "completo": true },
      "occupations": [
        {
          "reservationId": "...", "reservationCode": "RS-A1B2C3",
          "periodoFormatado": "01/09/2026, das 08:00 às 10:00",
          "room": "Sala 12", "purpose": "Aula de geometria",
          "holder": { "id": "...", "fullName": "Carlos Silva", "whatsappDisponivel": true }
        }
      ]
    }
  ],
  "notebooks": [],
  "resumo": { "kitsDisponiveis": 2, "kitsReservados": 1, "...": 0 }
}
```

`state` é o estado **no período consultado**: `DISPONIVEL`, `RESERVADO`,
`MANUTENCAO` ou `INDISPONIVEL`.

Sobre o ocupante são expostos apenas nome, período, sala e finalidade — o que a
especificação considera apropriado no contexto institucional. Telefone e e-mail
**nunca** aparecem; a existência de contato autorizado vem como um booleano.

Um notebook que pertence a um kit reservado é devolvido como `RESERVADO`, mesmo
sem reserva própria: quem levou a maleta levou o notebook junto.

---

## Reservas

### `GET /api/reservations` · autenticado

Filtros: `status` (repetível), `from`, `to`, `kitId`, `notebookId`, `search`,
`userId` (ignorado para professores), `page`, `pageSize`.

### `POST /api/reservations` · autenticado

```json
{
  "date": "2026-09-01",
  "startTime": "08:00",
  "endTime": "10:00",
  "kitIds": ["..."],
  "notebookIds": ["..."],
  "purpose": "Aula de geometria",
  "className": "8º ano B",
  "subject": "Matemática",
  "room": "Sala 12",
  "requestedNotebooks": 25,
  "teacherNotes": "..."
}
```

`startTime`/`endTime` são obrigatórios quando a configuração `requireTimeRange`
está ligada; sem eles a reserva cobre o dia inteiro. É preciso ao menos um kit
ou um notebook. Supervisores podem passar `userId` (reservar em nome de alguém)
e `status`.

**Conflito (409 · `CONFLITO_RESERVA`)** traz o que a interface precisa para
oferecer o contato:

```json
{
  "erro": {
    "codigo": "CONFLITO_RESERVA",
    "mensagem": "Um ou mais recursos já estão reservados neste período.",
    "detalhes": {
      "conflitos": [
        {
          "resourceKey": "kit:...", "resourceLabel": "Maleta 01 (MAL-001)",
          "reservationId": "...", "reservationCode": "RS-A1B2C3",
          "periodoFormatado": "01/09/2026, das 08:00 às 10:00",
          "room": "Sala 12", "purpose": "Aula de geometria",
          "holder": { "id": "...", "fullName": "Carlos Silva", "whatsappDisponivel": true }
        }
      ]
    }
  }
}
```

### `GET /api/reservations/{id}` · dono ou supervisão
### `PATCH /api/reservations/{id}` · dono (limitado) ou supervisão

O professor altera apenas dados da aula (finalidade, turma, disciplina, sala,
observações). Mudar data, horário, equipamentos ou status exige supervisão — o
professor cancela e cria de novo, para que as regras de disponibilidade sejam
reavaliadas do zero.

### `POST /api/reservations/{id}/cancel`

```json
{ "reason": "Aula remarcada" }
```

Libera os recursos imediatamente. As regras de prazo valem para o professor; a
supervisão cancela sempre.

### `POST /api/reservations/{id}/close`

```json
{
  "allGood": false,
  "notes": "...",
  "status": "ENCERRADA",
  "incident": {
    "targetType": "NOTEBOOK",
    "notebookId": "...",
    "category": "ACESSORIO_AUSENTE",
    "severity": "MEDIA",
    "description": "O mouse não voltou com a maleta."
  }
}
```

Encerra a reserva e, quando `incident` vem preenchido, registra a ocorrência na
mesma operação.

### `POST /api/reservations/{id}/whatsapp` · autenticado

Gera o link de contato com o docente da reserva informada.

```json
{ "disponivel": true, "url": "https://wa.me/55...?text=...", "mensagem": "Olá, professor(a)..." }
```

Sem telefone autorizado responde `200` com orientação — não é erro:

```json
{ "disponivel": false, "motivo": "Este docente não disponibilizou contato por WhatsApp..." }
```

O número **nunca** é devolvido, apenas o link pronto. Registra-se somente o
evento (quem pediu, para quem, quando), jamais o conteúdo da conversa. Gerar o
link não altera reserva nenhuma nem contorna a disponibilidade.

### `GET /api/reservations/{id}/history`

Histórico de alterações, do mais recente para o mais antigo.

---

## Inventário

| Rota | Método | Perfil |
|---|---|---|
| `/api/kits` | `GET` | autenticado |
| `/api/kits` | `POST` | supervisão |
| `/api/kits/{id}` | `GET` | autenticado |
| `/api/kits/{id}` | `PATCH` `DELETE` | supervisão |
| `/api/kits/{id}/history` | `GET` | supervisão |
| `/api/notebooks` | `GET` | autenticado |
| `/api/notebooks` | `POST` | supervisão |
| `/api/notebooks/bulk` | `POST` | supervisão |
| `/api/notebooks/{id}` | `GET` | autenticado |
| `/api/notebooks/{id}` | `PATCH` `DELETE` | supervisão |
| `/api/notebooks/{id}/history` | `GET` | supervisão |
| `/api/charger-kits` | `GET` `POST` | supervisão |
| `/api/charger-kits/{id}` | `GET` `PATCH` `DELETE` | supervisão |

`DELETE` é **desativação lógica** (status `DESATIVADO`), não remoção: apagar
levaria junto o histórico de quem já usou o equipamento. Recursos com reserva
futura ativa não podem ser desativados.

### Regra de capacidade

Vincular notebooks além da capacidade do kit, ou reduzir a capacidade abaixo do
número já vinculado, retorna `422 REGRA_DE_NEGOCIO` com a contagem atual na
mensagem. Reenviar com `confirmCapacityOverflow: true` autoriza a operação e
registra na auditoria que houve confirmação administrativa explícita.

### Cadastro em lote

```json
POST /api/notebooks/bulk
{ "prefix": "NB-", "startNumber": 1, "quantity": 20, "padding": 3, "kitId": "..." }
```

Gera `NB-001` … `NB-020`. O prefixo é usado literalmente — quem quiser separador
o inclui. Roda em uma transação: se qualquer patrimônio já existir, **nada** é
gravado e a resposta lista os que colidiram.

### Carregadores

`COMPLETO`/`INCOMPLETO` é **derivado** da comparação entre `availableQuantity` e
`totalQuantity` a cada alteração. A supervisão define manualmente apenas
`MANUTENCAO`, `INDISPONIVEL` e `DESATIVADO`.

---

## Ocorrências

### `GET /api/incidents` · autenticado

Professor vê apenas o que registrou; supervisão vê tudo. Filtros: `status`,
`severity`, `category`, `targetType`, `notebookId`, `kitId`, `reservationId`,
`assignedToId`, `from`, `to`, `busca`.

### `POST /api/incidents` · autenticado

```json
{
  "targetType": "NOTEBOOK",
  "notebookId": "...",
  "reservationId": "...",
  "category": "TELA",
  "severity": "ALTA",
  "description": "Listras verticais ao ligar.",
  "blockResource": true
}
```

O professor precisa apontar **uma reserva sua** em que usou o equipamento — é a
tradução direta de "registrar problemas relacionados às suas reservas". Para
problemas fora desse contexto, a orientação é procurar a supervisão.

Resposta:

```json
{
  "ocorrencia": { "code": "OC-A1B2C3", "status": "ABERTA", "...": "" },
  "sugerirBloqueio": true,
  "recursoBloqueado": true,
  "aviso": "Severidade alta: avalie bloquear Notebook NB-003 para manutenção."
}
```

Severidade `ALTA` ou `CRITICA` **sugere** tirar o equipamento de circulação;
`blockResource: true` aplica na mesma transação. O bloqueio nunca é automático —
ele derrubaria aulas já agendadas sem ninguém saber. Reservas existentes **não**
são canceladas.

### `PATCH /api/incidents/{id}` · supervisão

Muda status, atribui responsável e registra a solução. Resolver a ocorrência
**não** devolve o equipamento à circulação: só a supervisão sabe se o conserto
foi conferido, e a liberação é feita na tela de inventário.

### `POST /api/incidents/{id}/attachments` · autenticado

`multipart/form-data`, campo `file`. Máximo 5 MB, JPG/PNG/WEBP, até 5 anexos por
ocorrência. O tipo é confirmado pelos primeiros bytes do arquivo, não pelo
`Content-Type` informado.

### `GET /api/attachments/{id}` · autenticado

Serve o binário depois de verificar a permissão.

---

## Supervisão

### `GET /api/admin/dashboard`

Reservas de hoje, próximas e atrasadas; kits em uso; notebooks por status;
ocorrências abertas por severidade; devoluções pendentes; carregadores
incompletos; utilização dos kits nos últimos 30 dias.

### `GET /api/admin/users` · `POST /api/admin/users`
### `GET /api/admin/users/{id}` · `PATCH /api/admin/users/{id}`
### `POST /api/admin/users/{id}/reset-password`
### `GET /api/admin/users/{id}/history`

Desativar uma conta e redefinir uma senha **encerram todas as sessões abertas**
daquele usuário na mesma operação. Um supervisor não pode desativar nem
rebaixar a si mesmo, e o sistema recusa remover o último supervisor ativo.

### `GET /api/admin/audit-logs`

Filtros: `entity`, `entityId`, `actorId`, `action`, `from`, `to`. Campos
sensíveis já foram removidos na gravação.

### `GET /api/admin/reports`

`tipo` = `utilizacao` | `professores` | `ocorrencias` | `conflitos` |
`indisponiveis` | `historico`. Com `formato=csv`, responde `text/csv` com BOM
UTF-8 e separador `;` — o formato que o Excel em português abre sem quebrar
acentuação.

### `GET /api/admin/settings` · `PATCH /api/admin/settings`

Configurações de reserva, carregadores, WhatsApp e operação. Alterações valem
para novas reservas; as existentes não são reavaliadas.

### `GET /api/search` · autenticado

Busca global por patrimônio, código de kit, código de reserva, código de
ocorrência e nome de professor. Professor encontra apenas os próprios registros.

---

## `GET /api/health` · público

```json
{ "status": "ok", "database": "ok", "uptimeSeconds": 3600, "latencyMs": 2, "timestamp": "..." }
```

`200` quando a aplicação responde **e** o banco está acessível; `503` com
`"status": "degradado"` caso contrário. É o endpoint usado pelo health check do
Coolify e pelo `HEALTHCHECK` do Docker.
