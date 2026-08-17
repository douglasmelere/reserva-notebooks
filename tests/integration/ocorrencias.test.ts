import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/session";
import {
  createIncident,
  getIncident,
  listIncidents,
  shouldSuggestBlock,
  updateIncident,
} from "@/server/incidents";
import { closeReservation, createReservation } from "@/server/reservations";
import { getAvailability } from "@/server/availability";
import {
  createTestChargerKit,
  createTestKit,
  createTestNotebook,
  createTestUser,
  futureDate,
  resetDatabase,
  toSessionUser,
} from "../helpers/db";

let supervisor: SessionUser;
let professor: SessionUser;
let outroProfessor: SessionUser;

beforeEach(async () => {
  await resetDatabase();
  supervisor = toSessionUser((await createTestUser({ role: "SUPERVISOR" })).user);
  professor = toSessionUser((await createTestUser()).user);
  outroProfessor = toSessionUser((await createTestUser()).user);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Cria uma reserva do professor cobrindo os recursos informados.
 *
 * O serviço exige que o professor aponte a reserva em que usou o equipamento —
 * é a tradução literal do requisito "registrar problemas relacionados às suas
 * reservas". Quase todo cenário abaixo precisa desse contexto.
 */
async function reservaDoProfessor(
  opts: { kitIds?: string[]; notebookIds?: string[]; ator?: SessionUser } = {},
) {
  return createReservation({
    actor: opts.ator ?? professor,
    date: futureDate(2),
    startTime: "08:00",
    endTime: "10:00",
    kitIds: opts.kitIds,
    notebookIds: opts.notebookIds,
  });
}

describe("registro de ocorrência", () => {
  it("professor registra problema em notebook", async () => {
    const notebook = await createTestNotebook();
    const reserva = await reservaDoProfessor({ notebookIds: [notebook.id] });

    const resultado = await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: notebook.id,
        reservationId: reserva.id,
        category: "TELA",
        severity: "MEDIA",
        description: "A tela apresenta listras verticais ao ligar.",
      },
      professor,
    );

    expect(resultado.ocorrencia.code).toMatch(/^OC-/);
    expect(resultado.ocorrencia.status).toBe("ABERTA");
    expect(resultado.sugerirBloqueio).toBe(false);
    expect(resultado.recursoBloqueado).toBe(false);
  });

  it("registra ocorrência em kit de carregadores", async () => {
    const kit = await createTestKit();
    const carregadores = await createTestChargerKit(kit.id, {
      total: 10,
      available: 7,
    });

    const reserva = await reservaDoProfessor({ kitIds: [kit.id] });

    const resultado = await createIncident(
      {
        targetType: "CHARGER_KIT",
        chargerKitId: carregadores.id,
        reservationId: reserva.id,
        category: "CARREGADOR_FALTANTE",
        severity: "MEDIA",
        description: "Faltavam 3 fontes na devolução do carrinho.",
      },
      professor,
    );

    expect(resultado.ocorrencia.code).toBeTruthy();
  });

  it("recusa alvo inexistente", async () => {
    await expect(
      createIncident(
        {
          targetType: "NOTEBOOK",
          notebookId: "id-que-nao-existe",
          category: "HARDWARE",
          severity: "BAIXA",
          description: "Descrição qualquer para o teste.",
        },
        professor,
      ),
    ).rejects.toThrow();
  });
});

describe("severidade alta sugere bloqueio", () => {
  it("shouldSuggestBlock sinaliza apenas alta e crítica em equipamento", () => {
    expect(shouldSuggestBlock("NOTEBOOK", "ALTA")).toBe(true);
    expect(shouldSuggestBlock("NOTEBOOK", "CRITICA")).toBe(true);
    expect(shouldSuggestBlock("NOTEBOOK", "MEDIA")).toBe(false);
    expect(shouldSuggestBlock("NOTEBOOK", "BAIXA")).toBe(false);
    // Uma ocorrência sobre a reserva inteira não bloqueia equipamento nenhum.
    expect(shouldSuggestBlock("RESERVATION", "CRITICA")).toBe(false);
  });

  it("sugere bloqueio sem aplicar sozinho", async () => {
    const notebook = await createTestNotebook();
    const reserva = await reservaDoProfessor({ notebookIds: [notebook.id] });

    const resultado = await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: notebook.id,
        reservationId: reserva.id,
        category: "DANO_FISICO",
        severity: "CRITICA",
        description: "Tela trincada após queda durante a aula.",
      },
      professor,
    );

    expect(resultado.sugerirBloqueio).toBe(true);
    // Bloquear é decisão de quem registra ou da supervisão — nunca automática.
    expect(resultado.recursoBloqueado).toBe(false);

    const atual = await prisma.notebook.findUnique({ where: { id: notebook.id } });
    expect(atual!.status).toBe("DISPONIVEL");
  });

  it("aplica o bloqueio quando pedido e tira o equipamento da disponibilidade", async () => {
    const notebook = await createTestNotebook();
    const reserva = await reservaDoProfessor({ notebookIds: [notebook.id] });

    const resultado = await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: notebook.id,
        reservationId: reserva.id,
        category: "DANO_FISICO",
        severity: "CRITICA",
        description: "Tela trincada após queda durante a aula.",
        blockResource: true,
      },
      professor,
    );

    expect(resultado.recursoBloqueado).toBe(true);
    expect(resultado.aviso).toBeTruthy();

    const atual = await prisma.notebook.findUnique({ where: { id: notebook.id } });
    expect(atual!.status).toBe("MANUTENCAO");

    const disponibilidade = await getAvailability({ date: futureDate(3) });
    expect(disponibilidade.notebooks.find((n) => n.id === notebook.id)?.state).toBe(
      "MANUTENCAO",
    );
  });

  it("professor não bloqueia equipamento em ocorrência de severidade baixa", async () => {
    const notebook = await createTestNotebook();
    const reserva = await reservaDoProfessor({ notebookIds: [notebook.id] });

    await expect(
      createIncident(
        {
          targetType: "NOTEBOOK",
          notebookId: notebook.id,
          reservationId: reserva.id,
          category: "LIMPEZA",
          severity: "BAIXA",
          description: "Teclado com migalhas; precisa de limpeza.",
          blockResource: true,
        },
        professor,
      ),
    ).rejects.toMatchObject({ code: "REGRA_DE_NEGOCIO" });
  });
});

describe("visibilidade", () => {
  it("professor vê apenas as ocorrências que registrou", async () => {
    const nb1 = await createTestNotebook();
    const nb2 = await createTestNotebook();
    const r1 = await reservaDoProfessor({ notebookIds: [nb1.id] });
    const r2 = await reservaDoProfessor({
      notebookIds: [nb2.id],
      ator: outroProfessor,
    });

    await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: nb1.id,
        reservationId: r1.id,
        category: "REDE",
        severity: "BAIXA",
        description: "Não conecta na rede sem fio da escola.",
      },
      professor,
    );
    await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: nb2.id,
        reservationId: r2.id,
        category: "BATERIA",
        severity: "BAIXA",
        description: "A bateria dura menos de trinta minutos.",
      },
      outroProfessor,
    );

    const doProfessor = await listIncidents({}, professor);
    expect(doProfessor.total).toBe(1);

    const doSupervisor = await listIncidents({}, supervisor);
    expect(doSupervisor.total).toBe(2);
  });

  it("professor não abre a ocorrência de outro", async () => {
    const nb = await createTestNotebook();
    const reserva = await reservaDoProfessor({
      notebookIds: [nb.id],
      ator: outroProfessor,
    });
    const criada = await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: nb.id,
        reservationId: reserva.id,
        category: "SISTEMA",
        severity: "BAIXA",
        description: "O sistema demora muito para iniciar.",
      },
      outroProfessor,
    );

    await expect(
      getIncident(criada.ocorrencia.id, professor),
    ).rejects.toMatchObject({ code: "NAO_ENCONTRADO" });
  });
});

describe("gestão pela supervisão", () => {
  it("professor não altera status nem atribui responsável", async () => {
    const nb = await createTestNotebook();
    const reserva = await reservaDoProfessor({ notebookIds: [nb.id] });
    const criada = await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: nb.id,
        reservationId: reserva.id,
        category: "TECLADO",
        severity: "MEDIA",
        description: "Três teclas não respondem.",
      },
      professor,
    );

    await expect(
      updateIncident(
        criada.ocorrencia.id,
        { status: "RESOLVIDA" },
        professor,
      ),
    ).rejects.toMatchObject({ code: "SEM_PERMISSAO" });
  });

  it("supervisão atribui responsável, resolve e registra solução", async () => {
    const nb = await createTestNotebook();
    const reserva = await reservaDoProfessor({ notebookIds: [nb.id] });
    const criada = await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: nb.id,
        reservationId: reserva.id,
        category: "TECLADO",
        severity: "MEDIA",
        description: "Três teclas não respondem.",
      },
      professor,
    );

    const atualizada = await updateIncident(
      criada.ocorrencia.id,
      {
        status: "RESOLVIDA",
        assignedToId: supervisor.id,
        resolution: "Teclado substituído pela assistência técnica.",
      },
      supervisor,
    );

    expect(atualizada.ocorrencia.status).toBe("RESOLVIDA");
    expect(atualizada.ocorrencia.resolvedAt).toBeTruthy();
  });

  it("resolver a ocorrência NÃO libera o equipamento sozinho", async () => {
    const nb = await createTestNotebook();
    const reserva = await reservaDoProfessor({ notebookIds: [nb.id] });
    const criada = await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: nb.id,
        reservationId: reserva.id,
        category: "DANO_FISICO",
        severity: "CRITICA",
        description: "Carcaça quebrada e dobradiça solta.",
        blockResource: true,
      },
      professor,
    );

    await updateIncident(
      criada.ocorrencia.id,
      { status: "RESOLVIDA", resolution: "Reparado." },
      supervisor,
    );

    // Quem devolve o equipamento à circulação é a supervisão, na tela de
    // inventário: só ela sabe se o conserto foi conferido.
    const atual = await prisma.notebook.findUnique({ where: { id: nb.id } });
    expect(atual!.status).toBe("MANUTENCAO");
  });

  it("registra auditoria da alteração", async () => {
    const nb = await createTestNotebook();
    const reserva = await reservaDoProfessor({ notebookIds: [nb.id] });
    const criada = await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: nb.id,
        reservationId: reserva.id,
        category: "OUTRO",
        severity: "BAIXA",
        description: "Observação geral sobre o equipamento.",
      },
      professor,
    );

    await updateIncident(
      criada.ocorrencia.id,
      { status: "EM_ANALISE" },
      supervisor,
    );

    const logs = await prisma.auditLog.findMany({
      where: { entity: "Incident", entityId: criada.ocorrencia.id },
    });
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe("ocorrência no encerramento da reserva", () => {
  it("encerrar informando problema cria a ocorrência vinculada", async () => {
    const kit = await createTestKit();
    const notebook = await createTestNotebook({ kitId: kit.id });

    const reserva = await createReservation({
      actor: professor,
      date: futureDate(2),
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    await closeReservation(reserva.id, { allGood: false }, professor);

    const ocorrencia = await createIncident(
      {
        targetType: "NOTEBOOK",
        notebookId: notebook.id,
        reservationId: reserva.id,
        category: "ACESSORIO_AUSENTE",
        severity: "MEDIA",
        description: "O mouse do notebook não voltou junto com a maleta.",
      },
      professor,
    );

    expect(ocorrencia.ocorrencia.code).toBeTruthy();

    const doBanco = await prisma.incident.findUnique({
      where: { id: ocorrencia.ocorrencia.id },
    });
    expect(doBanco!.reservationId).toBe(reserva.id);

    // A reserva encerrada continua encerrada e o recurso, livre.
    const reservaFinal = await prisma.reservation.findUnique({
      where: { id: reserva.id },
      include: { items: true },
    });
    expect(reservaFinal!.status).toBe("ENCERRADA");
    expect(reservaFinal!.items.every((i) => !i.blocking)).toBe(true);
  });
});
