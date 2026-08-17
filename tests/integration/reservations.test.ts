import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { updateSettings } from "@/lib/settings";
import {
  cancelReservation,
  closeReservation,
  createReservation,
  findConflicts,
  getReservation,
  listReservations,
} from "@/server/reservations";
import { getAvailability } from "@/server/availability";
import { kitKey } from "@/server/resources";
import {
  createTestKit,
  createTestNotebook,
  createTestUser,
  futureDate,
  resetDatabase,
  seedReservation,
  toSessionUser,
} from "../helpers/db";

/**
 * Testes de reserva contra um PostgreSQL real.
 *
 * A garantia central do sistema — duas pessoas não conseguirem reservar o mesmo
 * equipamento no mesmo período — depende de uma restrição EXCLUDE do banco e de
 * transações. Contra um banco simulado, o teste de concorrência passaria
 * mesmo com a implementação errada.
 */

const DIA = futureDate(7);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("criação de reserva", () => {
  it("reserva uma maleta", async () => {
    const { user } = await createTestUser();
    const maleta = await createTestKit({ type: "MALETA", name: "Maleta 01" });

    const reserva = await createReservation({
      actor: toSessionUser(user),
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [maleta.id],
      purpose: "Aula de geometria",
      room: "Sala 12",
    });

    expect(reserva.status).toBe("CONFIRMADA");
    expect(reserva.code).toMatch(/^RS-/);
    expect(reserva.items).toHaveLength(1);
    expect(reserva.items[0]!.type).toBe("KIT");
    expect(reserva.items[0]!.blocking).toBe(true);
    expect(reserva.items[0]!.resourceKey).toBe(kitKey(maleta.id));

    // Persistiu de verdade, com o intervalo copiado para o item.
    const doBanco = await prisma.reservation.findUnique({
      where: { id: reserva.id },
      include: { items: true },
    });
    expect(doBanco).not.toBeNull();
    expect(doBanco!.items[0]!.startsAt.getTime()).toBe(
      doBanco!.startsAt.getTime(),
    );
  });

  it("reserva um carrinho", async () => {
    const { user } = await createTestUser();
    const carrinho = await createTestKit({ type: "CARRINHO", capacity: 20 });

    const reserva = await createReservation({
      actor: toSessionUser(user),
      date: DIA,
      startTime: "13:00",
      endTime: "15:00",
      kitIds: [carrinho.id],
    });

    expect(reserva.items[0]!.kitId).toBe(carrinho.id);
  });

  it("reserva notebooks avulsos", async () => {
    const { user } = await createTestUser();
    const nb1 = await createTestNotebook();
    const nb2 = await createTestNotebook();

    const reserva = await createReservation({
      actor: toSessionUser(user),
      date: DIA,
      startTime: "08:00",
      endTime: "09:00",
      notebookIds: [nb1.id, nb2.id],
    });

    expect(reserva.items).toHaveLength(2);
    expect(reserva.items.every((i) => i.type === "NOTEBOOK")).toBe(true);
  });

  it("reserva kit e notebook avulso na mesma operação", async () => {
    const { user } = await createTestUser();
    const kit = await createTestKit();
    const notebook = await createTestNotebook();

    const reserva = await createReservation({
      actor: toSessionUser(user),
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
      notebookIds: [notebook.id],
    });

    expect(reserva.items).toHaveLength(2);
    expect(reserva.items.filter((i) => i.type === "KIT")).toHaveLength(1);
    expect(reserva.items.filter((i) => i.type === "NOTEBOOK")).toHaveLength(1);
  });

  it("recusa reserva sem nenhum recurso", async () => {
    const { user } = await createTestUser();
    await expect(
      createReservation({
        actor: toSessionUser(user),
        date: DIA,
        startTime: "08:00",
        endTime: "10:00",
      }),
    ).rejects.toThrow(/ao menos um kit ou notebook/i);
  });
});

describe("conflito de horário", () => {
  it("bloqueia reserva sobreposta do mesmo kit", async () => {
    const { user: dono } = await createTestUser({ fullName: "Ana Souza" });
    const { user: outro } = await createTestUser();
    const kit = await createTestKit({ name: "Maleta 01" });

    await seedReservation({
      userId: dono.id,
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    const erro = await createReservation({
      actor: toSessionUser(outro),
      date: DIA,
      startTime: "09:00",
      endTime: "11:00",
      kitIds: [kit.id],
    }).catch((e) => e);

    expect(isAppError(erro)).toBe(true);
    expect(erro.code).toBe("CONFLITO_RESERVA");

    // O erro precisa carregar quem está com o equipamento, para a interface
    // poder oferecer o contato.
    const conflitos = (erro.details as { conflitos: unknown[] }).conflitos;
    expect(conflitos).toHaveLength(1);
    expect((conflitos[0] as { holder: { fullName: string } }).holder.fullName).toBe(
      "Ana Souza",
    );
  });

  it("permite reservas encostadas (uma termina quando a outra começa)", async () => {
    const { user: a } = await createTestUser();
    const { user: b } = await createTestUser();
    const kit = await createTestKit();

    await seedReservation({
      userId: a.id,
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    const segunda = await createReservation({
      actor: toSessionUser(b),
      date: DIA,
      startTime: "10:00",
      endTime: "12:00",
      kitIds: [kit.id],
    });

    expect(segunda.id).toBeTruthy();
  });

  it("uma reserva de dia inteiro bloqueia o dia todo", async () => {
    const { user: a } = await createTestUser();
    const { user: b } = await createTestUser();
    const kit = await createTestKit();

    await updateSettings({ requireTimeRange: false }, null);

    await seedReservation({
      userId: a.id,
      date: DIA,
      startTime: null,
      endTime: null,
      kitIds: [kit.id],
    });

    await expect(
      createReservation({
        actor: toSessionUser(b),
        date: DIA,
        startTime: "14:00",
        endTime: "15:00",
        kitIds: [kit.id],
      }),
    ).rejects.toMatchObject({ code: "CONFLITO_RESERVA" });
  });

  it("reserva cancelada libera o recurso", async () => {
    const { user: a } = await createTestUser();
    const { user: b } = await createTestUser();
    const kit = await createTestKit();

    const primeira = await createReservation({
      actor: toSessionUser(a),
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    await cancelReservation(primeira.id, "Mudança de planos", toSessionUser(a));

    const segunda = await createReservation({
      actor: toSessionUser(b),
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    expect(segunda.id).toBeTruthy();
  });

  it("um notebook dentro de um kit reservado aparece como ocupado", async () => {
    const { user } = await createTestUser();
    const kit = await createTestKit();
    const notebook = await createTestNotebook({ kitId: kit.id });

    await seedReservation({
      userId: user.id,
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    const disponibilidade = await getAvailability({
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
    });

    const estado = disponibilidade.notebooks.find((n) => n.id === notebook.id);
    expect(estado?.state).toBe("RESERVADO");
  });
});

describe("concorrência", () => {
  /**
   * O caso que motiva a restrição EXCLUDE: dois professores clicam em
   * "confirmar" no mesmo instante, para o mesmo equipamento e o mesmo horário.
   * Exatamente um pode ganhar.
   */
  it("duas reservas simultâneas do mesmo kit: só uma é aceita", async () => {
    const { user: a } = await createTestUser({ username: "concorrente.a" });
    const { user: b } = await createTestUser({ username: "concorrente.b" });
    const kit = await createTestKit({ name: "Carrinho disputado" });

    const tentativa = (userId: ReturnType<typeof toSessionUser>) =>
      createReservation({
        actor: userId,
        date: DIA,
        startTime: "08:00",
        endTime: "10:00",
        kitIds: [kit.id],
      });

    const resultados = await Promise.allSettled([
      tentativa(toSessionUser(a)),
      tentativa(toSessionUser(b)),
    ]);

    const aceitas = resultados.filter((r) => r.status === "fulfilled");
    const recusadas = resultados.filter((r) => r.status === "rejected");

    expect(aceitas).toHaveLength(1);
    expect(recusadas).toHaveLength(1);

    // A recusa precisa ser o erro de conflito tratado, e não um erro cru do
    // banco vazando para o usuário.
    const erro = (recusadas[0] as PromiseRejectedResult).reason;
    expect(isAppError(erro)).toBe(true);
    expect(erro.code).toBe("CONFLITO_RESERVA");

    // E o banco não pode ter ficado com dois itens bloqueantes.
    const itens = await prisma.reservationItem.count({
      where: { resourceKey: kitKey(kit.id), blocking: true },
    });
    expect(itens).toBe(1);
  });

  it("dez tentativas simultâneas: exatamente uma vence", async () => {
    const kit = await createTestKit();
    const usuarios = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createTestUser({ username: `disputa${i}` }),
      ),
    );

    const resultados = await Promise.allSettled(
      usuarios.map(({ user }) =>
        createReservation({
          actor: toSessionUser(user),
          date: DIA,
          startTime: "14:00",
          endTime: "16:00",
          kitIds: [kit.id],
        }),
      ),
    );

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const itens = await prisma.reservationItem.count({
      where: { resourceKey: kitKey(kit.id), blocking: true },
    });
    expect(itens).toBe(1);
  });

  it("a restrição do banco recusa sobreposição mesmo por escrita direta", async () => {
    // Prova que a garantia não depende da camada de serviço: mesmo escrevendo
    // no banco por fora das regras, a sobreposição é impossível.
    const { user } = await createTestUser();
    const kit = await createTestKit();

    await seedReservation({
      userId: user.id,
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
      code: "RS-DIRETO1",
    });

    await expect(
      seedReservation({
        userId: user.id,
        date: DIA,
        startTime: "09:00",
        endTime: "11:00",
        kitIds: [kit.id],
        code: "RS-DIRETO2",
      }),
    ).rejects.toThrow();
  });
});

describe("recursos indisponíveis", () => {
  it("kit em manutenção não pode ser reservado", async () => {
    const { user } = await createTestUser();
    const kit = await createTestKit({ status: "MANUTENCAO" });

    await expect(
      createReservation({
        actor: toSessionUser(user),
        date: DIA,
        startTime: "08:00",
        endTime: "10:00",
        kitIds: [kit.id],
      }),
    ).rejects.toThrow(/não está disponível/i);
  });

  it("kit em manutenção não aparece como disponível", async () => {
    const kit = await createTestKit({ status: "MANUTENCAO" });
    const disponivel = await createTestKit({ status: "DISPONIVEL" });

    const resultado = await getAvailability({ date: DIA });

    expect(resultado.kits.find((k) => k.id === kit.id)?.state).toBe("MANUTENCAO");
    expect(resultado.kits.find((k) => k.id === disponivel.id)?.state).toBe(
      "DISPONIVEL",
    );
    expect(resultado.resumo.kitsDisponiveis).toBe(1);
  });

  it("notebook em manutenção não pode ser reservado", async () => {
    const { user } = await createTestUser();
    const notebook = await createTestNotebook({ status: "MANUTENCAO" });

    await expect(
      createReservation({
        actor: toSessionUser(user),
        date: DIA,
        startTime: "08:00",
        endTime: "10:00",
        notebookIds: [notebook.id],
      }),
    ).rejects.toThrow(/não está disponível/i);
  });

  it("não reserva para conta desativada", async () => {
    const { user: supervisor } = await createTestUser({ role: "SUPERVISOR" });
    const { user: inativo } = await createTestUser({ active: false });
    const kit = await createTestKit();

    await expect(
      createReservation({
        actor: toSessionUser(supervisor),
        userId: inativo.id,
        date: DIA,
        startTime: "08:00",
        endTime: "10:00",
        kitIds: [kit.id],
      }),
    ).rejects.toThrow(/desativada/i);
  });
});

describe("isolamento entre professores", () => {
  it("professor não enxerga a reserva de outro", async () => {
    const { user: dono } = await createTestUser();
    const { user: intruso } = await createTestUser();
    const kit = await createTestKit();

    const reserva = await seedReservation({
      userId: dono.id,
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    // A resposta é "não encontrada", e não "sem permissão": confirmar que a
    // reserva existe já seria informação demais.
    await expect(
      getReservation(reserva.id, toSessionUser(intruso)),
    ).rejects.toMatchObject({ code: "NAO_ENCONTRADO" });
  });

  it("listagem do professor traz apenas as próprias reservas", async () => {
    const { user: a } = await createTestUser();
    const { user: b } = await createTestUser();
    const kit1 = await createTestKit();
    const kit2 = await createTestKit();

    await seedReservation({
      userId: a.id,
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit1.id],
    });
    await seedReservation({
      userId: b.id,
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit2.id],
    });

    const listaDeA = await listReservations({}, toSessionUser(a));
    expect(listaDeA.total).toBe(1);
    expect(listaDeA.items[0]!.userId).toBe(a.id);

    // Nem forçando o filtro por outro usuário.
    const tentativa = await listReservations({ userId: b.id }, toSessionUser(a));
    expect(tentativa.items.every((r) => r.userId === a.id)).toBe(true);
  });

  it("supervisor enxerga todas as reservas", async () => {
    const { user: a } = await createTestUser();
    const { user: b } = await createTestUser();
    const { user: supervisor } = await createTestUser({ role: "SUPERVISOR" });
    const kit1 = await createTestKit();
    const kit2 = await createTestKit();

    await seedReservation({ userId: a.id, date: DIA, startTime: "08:00", endTime: "10:00", kitIds: [kit1.id] });
    await seedReservation({ userId: b.id, date: DIA, startTime: "08:00", endTime: "10:00", kitIds: [kit2.id] });

    const lista = await listReservations({}, toSessionUser(supervisor));
    expect(lista.total).toBe(2);
  });
});

describe("encerramento", () => {
  it("encerrar libera o recurso e registra a devolução", async () => {
    const { user } = await createTestUser();
    const kit = await createTestKit();

    const reserva = await createReservation({
      actor: toSessionUser(user),
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    const encerrada = await closeReservation(
      reserva.id,
      { allGood: true },
      toSessionUser(user),
    );

    expect(encerrada.status).toBe("ENCERRADA");
    expect(encerrada.closedAt).not.toBeNull();
    expect(encerrada.items.every((i) => !i.blocking)).toBe(true);

    const conflitos = await findConflicts(
      [kitKey(kit.id)],
      new Date(encerrada.startsAt),
      new Date(encerrada.endsAt),
    );
    expect(conflitos).toHaveLength(0);
  });

  it("não encerra duas vezes", async () => {
    const { user } = await createTestUser();
    const kit = await createTestKit();

    const reserva = await createReservation({
      actor: toSessionUser(user),
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    await closeReservation(reserva.id, { allGood: true }, toSessionUser(user));
    await expect(
      closeReservation(reserva.id, { allGood: true }, toSessionUser(user)),
    ).rejects.toThrow(/já foi encerrada/i);
  });
});

describe("auditoria", () => {
  it("registra criação e cancelamento com o autor", async () => {
    const { user } = await createTestUser();
    const kit = await createTestKit();

    const reserva = await createReservation({
      actor: toSessionUser(user),
      date: DIA,
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });
    await cancelReservation(reserva.id, "Aula cancelada", toSessionUser(user));

    const logs = await prisma.auditLog.findMany({
      where: { entity: "Reservation", entityId: reserva.id },
      orderBy: { createdAt: "asc" },
    });

    expect(logs.map((l) => l.action)).toEqual([
      "reserva.criar",
      "reserva.cancelar",
    ]);
    expect(logs.every((l) => l.actorId === user.id)).toBe(true);
    expect(logs[1]!.summary).toContain("Aula cancelada");
  });
});
