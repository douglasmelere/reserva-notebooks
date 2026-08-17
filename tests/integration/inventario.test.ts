import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  assertKitCapacity,
  createKit,
  deactivateKit,
  listKits,
  setKitStatus,
  updateKit,
} from "@/server/kits";
import {
  bulkCreateNotebooks,
  createNotebook,
  deactivateNotebook,
  listNotebooks,
  setNotebookStatus,
  transferToKit,
  updateNotebook,
} from "@/server/notebooks";
import { createChargerKit, updateChargerKit } from "@/server/chargers";
import { getAvailability } from "@/server/availability";
import {
  createTestKit,
  createTestNotebook,
  createTestUser,
  futureDate,
  resetDatabase,
  seedReservation,
  toSessionUser,
} from "../helpers/db";
import type { SessionUser } from "@/lib/session";

let supervisor: SessionUser;
let professor: SessionUser;

beforeEach(async () => {
  await resetDatabase();
  const sup = await createTestUser({ role: "SUPERVISOR" });
  const prof = await createTestUser();
  supervisor = toSessionUser(sup.user);
  professor = toSessionUser(prof.user);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("autorização do inventário", () => {
  it("professor não cadastra kit", async () => {
    await expect(
      createKit(
        { code: "K1", name: "Kit", type: "MALETA", capacity: 10 },
        professor,
      ),
    ).rejects.toMatchObject({ code: "SEM_PERMISSAO" });
  });

  it("professor não cadastra notebook", async () => {
    await expect(
      createNotebook({ assetTag: "NB-X" }, professor),
    ).rejects.toMatchObject({ code: "SEM_PERMISSAO" });
  });

  it("professor não desativa kit", async () => {
    const kit = await createTestKit();
    await expect(deactivateKit(kit.id, professor)).rejects.toMatchObject({
      code: "SEM_PERMISSAO",
    });
  });
});

describe("kits", () => {
  it("cadastra e edita um kit", async () => {
    const kit = await createKit(
      {
        code: "MAL-99",
        name: "Maleta 99",
        type: "MALETA",
        capacity: 12,
        location: "Sala 3",
      },
      supervisor,
    );

    expect(kit.code).toBe("MAL-99");
    expect(kit.capacity).toBe(12);

    const editado = await updateKit(
      kit.id,
      { name: "Maleta 99 (revisada)", capacity: 15 },
      supervisor,
    );
    expect(editado.name).toBe("Maleta 99 (revisada)");
    expect(editado.capacity).toBe(15);
  });

  it("recusa código duplicado com mensagem clara", async () => {
    await createKit(
      { code: "DUP", name: "A", type: "MALETA", capacity: 5 },
      supervisor,
    );
    await expect(
      createKit({ code: "DUP", name: "B", type: "CARRINHO", capacity: 5 }, supervisor),
    ).rejects.toThrow();
  });
});

describe("regra de capacidade", () => {
  it("bloqueia reduzir a capacidade abaixo dos notebooks já vinculados", async () => {
    const kit = await createTestKit({ capacity: 10 });
    for (let i = 0; i < 6; i++) {
      await createTestNotebook({ kitId: kit.id });
    }

    const erro = await updateKit(kit.id, { capacity: 4 }, supervisor).catch(
      (e) => e,
    );

    expect(erro.code).toBe("REGRA_DE_NEGOCIO");
    // A mensagem precisa dizer quantos existem, senão a supervisão não sabe
    // para quanto pode reduzir.
    expect(erro.message).toMatch(/6/);
  });

  it("permite reduzir com confirmação administrativa explícita", async () => {
    const kit = await createTestKit({ capacity: 10 });
    for (let i = 0; i < 6; i++) {
      await createTestNotebook({ kitId: kit.id });
    }

    const atualizado = await updateKit(
      kit.id,
      { capacity: 4, confirmCapacityOverflow: true },
      supervisor,
    );
    expect(atualizado.capacity).toBe(4);
  });

  it("bloqueia vincular notebook além da capacidade", async () => {
    const kit = await createTestKit({ capacity: 2 });
    await createNotebook({ assetTag: "C1", kitId: kit.id }, supervisor);
    await createNotebook({ assetTag: "C2", kitId: kit.id }, supervisor);

    await expect(
      createNotebook({ assetTag: "C3", kitId: kit.id }, supervisor),
    ).rejects.toMatchObject({ code: "REGRA_DE_NEGOCIO" });
  });

  it("assertKitCapacity relata o estado sem lançar quando cabe", async () => {
    const kit = await createTestKit({ capacity: 5 });
    await createTestNotebook({ kitId: kit.id });

    const check = await assertKitCapacity(kit.id, 2, false);
    expect(check.notebooksVinculados).toBe(1);
    expect(check.totalResultante).toBe(3);
    expect(check.excedeu).toBe(false);
  });
});

describe("notebooks", () => {
  it("cadastra em lote com numeração sequencial", async () => {
    const kit = await createTestKit({ capacity: 30 });

    const resultado = await bulkCreateNotebooks(
      {
        prefix: "LOTE",
        startNumber: 1,
        quantity: 5,
        padding: 3,
        kitId: kit.id,
      },
      supervisor,
    );

    const criados = await prisma.notebook.findMany({
      where: { kitId: kit.id },
      orderBy: { assetTag: "asc" },
    });
    // O prefixo é usado literalmente: quem quiser separador digita "LOTE-".
    // A tela de cadastro em lote mostra uma prévia justamente por isso.
    expect(criados.map((n) => n.assetTag)).toEqual([
      "LOTE001",
      "LOTE002",
      "LOTE003",
      "LOTE004",
      "LOTE005",
    ]);
    expect(resultado).toBeTruthy();
  });

  it("lote com patrimônio já existente não grava nada", async () => {
    const kit = await createTestKit({ capacity: 30 });
    await createNotebook({ assetTag: "LOTE002" }, supervisor);

    await expect(
      bulkCreateNotebooks(
        { prefix: "LOTE", startNumber: 1, quantity: 5, padding: 3, kitId: kit.id },
        supervisor,
      ),
    ).rejects.toThrow();

    // Nenhum notebook do lote pode ter entrado: a operação é tudo ou nada.
    const doKit = await prisma.notebook.count({ where: { kitId: kit.id } });
    expect(doKit).toBe(0);
  });

  it("editar um campo não devolve à circulação um notebook em manutenção", async () => {
    // Regressão: o esquema de PATCH trazia `status` com o valor padrão mesmo
    // quando não enviado, e renomear um equipamento quebrado o marcava como
    // disponível de novo — deixando-o reservável sem ninguém perceber.
    const notebook = await createTestNotebook({ status: "MANUTENCAO" });

    await updateNotebook(notebook.id, { nickname: "Apelido novo" }, supervisor);

    const atual = await prisma.notebook.findUnique({ where: { id: notebook.id } });
    expect(atual!.status).toBe("MANUTENCAO");
    expect(atual!.nickname).toBe("Apelido novo");
  });

  it("transfere notebook entre kits e registra na auditoria", async () => {
    const origem = await createTestKit({ capacity: 5 });
    const destino = await createTestKit({ capacity: 5 });
    const notebook = await createTestNotebook({ kitId: origem.id });

    await transferToKit(notebook.id, destino.id, supervisor);

    const atualizado = await prisma.notebook.findUnique({
      where: { id: notebook.id },
    });
    expect(atualizado!.kitId).toBe(destino.id);

    const logs = await prisma.auditLog.findMany({
      where: { entity: "Notebook", entityId: notebook.id },
    });
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe("status e disponibilidade", () => {
  it("kit em manutenção some da disponibilidade", async () => {
    const kit = await createTestKit();
    await setKitStatus(kit.id, "MANUTENCAO", supervisor);

    const disponibilidade = await getAvailability({ date: futureDate(3) });
    expect(disponibilidade.kits.find((k) => k.id === kit.id)?.state).toBe(
      "MANUTENCAO",
    );
    expect(disponibilidade.resumo.kitsDisponiveis).toBe(0);
  });

  it("mudar status de notebook informa quantas reservas futuras são afetadas", async () => {
    const notebook = await createTestNotebook();
    const { user } = await createTestUser();

    await seedReservation({
      userId: user.id,
      date: futureDate(5),
      startTime: "08:00",
      endTime: "10:00",
      notebookIds: [notebook.id],
    });

    const resultado = await setNotebookStatus(
      notebook.id,
      "MANUTENCAO",
      supervisor,
    );

    // A reserva NÃO é cancelada automaticamente — a supervisão precisa avisar
    // o professor, e para isso precisa saber que ela existe.
    const aindaAtiva = await prisma.reservation.count({
      where: { status: "CONFIRMADA" },
    });
    expect(aindaAtiva).toBe(1);
    expect(JSON.stringify(resultado)).toMatch(/1/);
  });

  it("não desativa kit com reserva futura ativa", async () => {
    const kit = await createTestKit();
    const { user } = await createTestUser();

    await seedReservation({
      userId: user.id,
      date: futureDate(5),
      startTime: "08:00",
      endTime: "10:00",
      kitIds: [kit.id],
    });

    await expect(deactivateKit(kit.id, supervisor)).rejects.toMatchObject({
      code: "REGRA_DE_NEGOCIO",
    });
  });

  it("desativação é lógica: o registro continua existindo", async () => {
    const kit = await createTestKit();
    await deactivateKit(kit.id, supervisor);

    const doBanco = await prisma.kit.findUnique({ where: { id: kit.id } });
    expect(doBanco).not.toBeNull();
    expect(doBanco!.status).toBe("DESATIVADO");
  });

  it("professor não vê recursos desativados nas listagens", async () => {
    const ativo = await createTestKit();
    const desativado = await createTestKit();
    await deactivateKit(desativado.id, supervisor);

    const paraProfessor = await listKits({}, professor);
    const ids = paraProfessor.items.map((k) => k.id);
    expect(ids).toContain(ativo.id);
    expect(ids).not.toContain(desativado.id);
  });

  it("notebook desativado não aparece para o professor", async () => {
    const ativo = await createTestNotebook();
    const desativado = await createTestNotebook();
    await deactivateNotebook(desativado.id, supervisor);

    const lista = await listNotebooks({}, professor);
    const ids = lista.items.map((n) => n.id);
    expect(ids).toContain(ativo.id);
    expect(ids).not.toContain(desativado.id);
  });
});

describe("kits de carregadores", () => {
  it("deriva COMPLETO e INCOMPLETO da quantidade", async () => {
    const kit = await createTestKit();

    const completo = await createChargerKit(
      { code: "CG-1", kitId: kit.id, totalQuantity: 10, availableQuantity: 10 },
      supervisor,
    );
    expect(completo.status).toBe("COMPLETO");

    const outroKit = await createTestKit();
    const incompleto = await createChargerKit(
      {
        code: "CG-2",
        kitId: outroKit.id,
        totalQuantity: 10,
        availableQuantity: 7,
        missingParts: "3 fontes na manutenção",
      },
      supervisor,
    );
    expect(incompleto.status).toBe("INCOMPLETO");
  });

  it("reduzir a quantidade disponível torna o kit incompleto sozinho", async () => {
    const kit = await createTestKit();
    const carregadores = await createChargerKit(
      { code: "CG-3", kitId: kit.id, totalQuantity: 10, availableQuantity: 10 },
      supervisor,
    );

    const atualizado = await updateChargerKit(
      carregadores.id,
      { availableQuantity: 8 },
      supervisor,
    );
    expect(atualizado.status).toBe("INCOMPLETO");
  });

  it("recusa disponível maior que o total", async () => {
    const kit = await createTestKit();
    await expect(
      createChargerKit(
        { code: "CG-4", kitId: kit.id, totalQuantity: 5, availableQuantity: 9 },
        supervisor,
      ),
    ).rejects.toThrow();
  });
});
