import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "@/lib/settings";
import { reservationInterval } from "@/lib/datetime";
import {
  assertCancellationAllowed,
  assertResourceCount,
  assertSchedulingAllowed,
  assertTransition,
  assertWithinActiveLimit,
  canTransition,
  isClosed,
  statusBlocks,
} from "@/server/reservation-policy";

/**
 * As regras de agendamento são as que a supervisão mais mexe. Testá-las sem
 * banco e sem servidor deixa barato alterá-las com confiança.
 */

const TZ = "America/Sao_Paulo";
const cfg = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings,
  ...patch,
});

/** Data futura em "AAAA-MM-DD". */
function emDias(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

function intervalo(dateStr: string, inicio = "08:00", fim = "10:00") {
  return reservationInterval(dateStr, inicio, fim, TZ);
}

describe("status que bloqueiam o recurso", () => {
  it("reserva ativa ocupa o equipamento", () => {
    expect(statusBlocks("CONFIRMADA")).toBe(true);
    expect(statusBlocks("EM_USO")).toBe(true);
    expect(statusBlocks("RETIRADA")).toBe(true);
    expect(statusBlocks("SOLICITADA")).toBe(true);
  });

  it("reserva finalizada libera o equipamento", () => {
    expect(statusBlocks("CANCELADA")).toBe(false);
    expect(statusBlocks("ENCERRADA")).toBe(false);
    expect(statusBlocks("DEVOLVIDA")).toBe(false);
    expect(statusBlocks("NAO_COMPARECEU")).toBe(false);
    expect(isClosed("CANCELADA")).toBe(true);
  });
});

describe("transições de status", () => {
  it("aceita o caminho normal de uso", () => {
    expect(canTransition("CONFIRMADA", "RETIRADA")).toBe(true);
    expect(canTransition("RETIRADA", "EM_USO")).toBe(true);
    expect(canTransition("EM_USO", "DEVOLVIDA")).toBe(true);
    expect(canTransition("DEVOLVIDA", "ENCERRADA")).toBe(true);
  });

  it("não reabre reserva finalizada", () => {
    expect(canTransition("CANCELADA", "CONFIRMADA")).toBe(false);
    expect(canTransition("ENCERRADA", "EM_USO")).toBe(false);
    expect(() => assertTransition("CANCELADA", "CONFIRMADA")).toThrow(
      /não é possível mudar o status/i,
    );
  });

  it("aceita status igual (edição que não mexe no status)", () => {
    expect(canTransition("CONFIRMADA", "CONFIRMADA")).toBe(true);
  });
});

describe("antecedência", () => {
  it("recusa data passada", () => {
    const i = intervalo(emDias(-1));
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg(),
        dateStr: emDias(-1),
        ...i,
        bypassPolicies: false,
      }),
    ).toThrow(/data passada/i);
  });

  it("recusa além da antecedência máxima", () => {
    const dia = emDias(90);
    const i = intervalo(dia);
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg({ maxAdvanceDays: 30 }),
        dateStr: dia,
        ...i,
        bypassPolicies: false,
      }),
    ).toThrow(/no máximo 30 dia/i);
  });

  it("recusa reserva no mesmo dia quando a política proíbe", () => {
    const hoje = emDias(0);
    const i = intervalo(hoje, "23:00", "23:30");
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg({ allowSameDay: false, closingTime: "23:59" }),
        dateStr: hoje,
        ...i,
        bypassPolicies: false,
      }),
    ).toThrow(/mesmo dia/i);
  });

  it("exige a antecedência mínima configurada", () => {
    const dia = emDias(1);
    const i = intervalo(dia);
    // 48h de antecedência mínima, reserva para amanhã: recusa.
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg({ minAdvanceHours: 48 }),
        dateStr: dia,
        ...i,
        bypassPolicies: false,
      }),
    ).toThrow(/pelo menos 48 hora/i);
  });

  it("supervisão contorna as políticas de antecedência", () => {
    const dia = emDias(365);
    const i = intervalo(dia);
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg({ maxAdvanceDays: 30 }),
        dateStr: dia,
        ...i,
        bypassPolicies: true,
      }),
    ).not.toThrow();
  });

  it("horário final antes do inicial é recusado até para a supervisão", () => {
    const dia = emDias(5);
    const inicio = new Date(Date.now() + 5 * 86_400_000);
    const fim = new Date(inicio.getTime() - 3_600_000);
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg(),
        dateStr: dia,
        startsAt: inicio,
        endsAt: fim,
        allDay: false,
        bypassPolicies: true,
      }),
    ).toThrow(/horário final/i);
  });
});

describe("horário de funcionamento", () => {
  it("recusa reserva fora do expediente", () => {
    const dia = emDias(3);
    const i = intervalo(dia, "05:00", "06:00");
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg({ openingTime: "07:00", closingTime: "22:00" }),
        dateStr: dia,
        ...i,
        bypassPolicies: false,
      }),
    ).toThrow(/entre 07:00 e 22:00/);
  });

  it("aceita reserva dentro do expediente", () => {
    const dia = emDias(3);
    const i = intervalo(dia, "07:00", "22:00");
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg(),
        dateStr: dia,
        ...i,
        bypassPolicies: false,
      }),
    ).not.toThrow();
  });

  it("reserva de dia inteiro não é medida contra o expediente", () => {
    const dia = emDias(3);
    const i = reservationInterval(dia, null, null, TZ);
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg({ requireTimeRange: false }),
        dateStr: dia,
        ...i,
        bypassPolicies: false,
      }),
    ).not.toThrow();
  });

  it("exige horário quando a configuração pede", () => {
    const dia = emDias(3);
    const i = reservationInterval(dia, null, null, TZ);
    expect(() =>
      assertSchedulingAllowed({
        settings: cfg({ requireTimeRange: true }),
        dateStr: dia,
        ...i,
        bypassPolicies: false,
      }),
    ).toThrow(/horário inicial e o horário final/i);
  });
});

describe("limites de quantidade", () => {
  it("exige ao menos um recurso", () => {
    expect(() => assertResourceCount(cfg(), 0, 0, false)).toThrow(
      /ao menos um kit ou notebook/i,
    );
  });

  it("respeita o máximo de recursos por reserva", () => {
    expect(() =>
      assertResourceCount(cfg({ maxResourcesPerReservation: 2 }), 2, 1, false),
    ).toThrow(/no máximo 2 recurso/i);
  });

  it("bloqueia combinar kit e avulso quando a política proíbe", () => {
    expect(() =>
      assertResourceCount(
        cfg({ allowMixedResourceReservation: false }),
        1,
        1,
        false,
      ),
    ).toThrow(/combinar kits e notebooks/i);
  });

  it("permite combinar por padrão", () => {
    expect(() => assertResourceCount(cfg(), 1, 2, false)).not.toThrow();
  });

  it("respeita o limite de reservas ativas por professor", () => {
    expect(() =>
      assertWithinActiveLimit(cfg({ maxActiveReservationsPerUser: 3 }), 3, false),
    ).toThrow(/limite configurado/i);

    // 0 significa "sem limite".
    expect(() =>
      assertWithinActiveLimit(cfg({ maxActiveReservationsPerUser: 0 }), 99, false),
    ).not.toThrow();

    // Supervisão não é limitada.
    expect(() =>
      assertWithinActiveLimit(cfg({ maxActiveReservationsPerUser: 1 }), 50, true),
    ).not.toThrow();
  });
});

describe("cancelamento", () => {
  const futuro = new Date(Date.now() + 48 * 3_600_000);
  const passado = new Date(Date.now() - 3_600_000);

  it("permite cancelar reserva futura", () => {
    expect(() =>
      assertCancellationAllowed(
        cfg(),
        { startsAt: futuro, status: "CONFIRMADA" },
        false,
      ),
    ).not.toThrow();
  });

  it("não cancela reserva já finalizada", () => {
    expect(() =>
      assertCancellationAllowed(
        cfg(),
        { startsAt: futuro, status: "CANCELADA" },
        false,
      ),
    ).toThrow(/não pode ser cancelada/i);
  });

  it("professor não cancela reserva que já começou", () => {
    expect(() =>
      assertCancellationAllowed(
        cfg({ allowCancelAfterStart: false }),
        { startsAt: passado, status: "EM_USO" },
        false,
      ),
    ).toThrow(/já começou/i);
  });

  it("supervisão cancela mesmo depois do início", () => {
    expect(() =>
      assertCancellationAllowed(
        cfg({ allowCancelAfterStart: false }),
        { startsAt: passado, status: "EM_USO" },
        true,
      ),
    ).not.toThrow();
  });

  it("respeita o prazo mínimo de cancelamento", () => {
    const daquiAPouco = new Date(Date.now() + 3_600_000); // 1 hora
    expect(() =>
      assertCancellationAllowed(
        cfg({ cancellationDeadlineHours: 24 }),
        { startsAt: daquiAPouco, status: "CONFIRMADA" },
        false,
      ),
    ).toThrow(/pelo menos 24 hora/i);
  });
});
