import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  formatDateBR,
  formatIntervalBR,
  overlaps,
  parseDateOnly,
  parseTimeOfDay,
  reservationInterval,
  toLocalDateString,
  toLocalTimeString,
  zonedToUtc,
} from "@/lib/datetime";

const TZ = "America/Sao_Paulo";

describe("conversão de fuso", () => {
  it("converte horário local para o instante UTC correto", () => {
    // São Paulo é UTC-3: 08:00 local é 11:00 UTC.
    const utc = zonedToUtc(2026, 9, 1, 8, 0, TZ);
    expect(utc.toISOString()).toBe("2026-09-01T11:00:00.000Z");
  });

  it("faz o caminho de volta sem perder a hora", () => {
    const utc = zonedToUtc(2026, 9, 1, 14, 30, TZ);
    expect(toLocalTimeString(utc, TZ)).toBe("14:30");
    expect(toLocalDateString(utc, TZ)).toBe("2026-09-01");
  });

  it("funciona em fuso com horário de verão", () => {
    // Nova York em julho está em EDT (UTC-4).
    const verao = zonedToUtc(2026, 7, 1, 12, 0, "America/New_York");
    expect(verao.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    // Em janeiro está em EST (UTC-5).
    const inverno = zonedToUtc(2026, 1, 15, 12, 0, "America/New_York");
    expect(inverno.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });
});

describe("parseDateOnly", () => {
  it("aceita data válida", () => {
    expect(parseDateOnly("2026-02-28")).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });

  it("recusa formato errado", () => {
    expect(() => parseDateOnly("28/02/2026")).toThrow(/Data inválida/);
  });

  it("recusa data que não existe no calendário", () => {
    // 2026 não é bissexto: 29 de fevereiro não existe.
    expect(() => parseDateOnly("2026-02-29")).toThrow(/inexistente/);
    expect(() => parseDateOnly("2026-13-01")).toThrow();
  });
});

describe("parseTimeOfDay", () => {
  it("aceita horário válido", () => {
    expect(parseTimeOfDay("07:05")).toEqual({ hour: 7, minute: 5 });
    expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
  });

  it("recusa horário inválido", () => {
    expect(() => parseTimeOfDay("24:00")).toThrow();
    expect(() => parseTimeOfDay("7:00")).toThrow();
    expect(() => parseTimeOfDay("07:60")).toThrow();
  });
});

describe("reservationInterval", () => {
  it("monta o intervalo a partir de data e horários", () => {
    const r = reservationInterval("2026-09-01", "08:00", "10:00", TZ);
    expect(r.allDay).toBe(false);
    expect(r.startsAt.toISOString()).toBe("2026-09-01T11:00:00.000Z");
    expect(r.endsAt.toISOString()).toBe("2026-09-01T13:00:00.000Z");
  });

  it("sem horários, cobre o dia inteiro no fuso local", () => {
    const r = reservationInterval("2026-09-01", null, null, TZ);
    expect(r.allDay).toBe(true);
    expect(r.startsAt.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(r.endsAt.toISOString()).toBe("2026-09-02T03:00:00.000Z");
    // Exatamente 24 horas.
    expect(r.endsAt.getTime() - r.startsAt.getTime()).toBe(86_400_000);
  });

  it("guarda a data civil sem deslocamento de fuso", () => {
    // Mesmo com o início em 03:00 UTC, a coluna DATE precisa registrar o dia
    // que o usuário escolheu.
    const r = reservationInterval("2026-09-01", "08:00", "10:00", TZ);
    expect(r.date.toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("recusa horário final anterior ou igual ao inicial", () => {
    expect(() => reservationInterval("2026-09-01", "10:00", "08:00", TZ)).toThrow();
    expect(() => reservationInterval("2026-09-01", "10:00", "10:00", TZ)).toThrow();
  });
});

describe("sobreposição de intervalos", () => {
  const d = (iso: string) => new Date(iso);

  it("detecta sobreposição parcial", () => {
    expect(
      overlaps(
        d("2026-09-01T13:00:00Z"),
        d("2026-09-01T15:00:00Z"),
        d("2026-09-01T14:00:00Z"),
        d("2026-09-01T16:00:00Z"),
      ),
    ).toBe(true);
  });

  it("intervalos apenas encostados NÃO se sobrepõem", () => {
    // Uma aula que termina às 10:00 libera o equipamento para a das 10:00.
    expect(
      overlaps(
        d("2026-09-01T13:00:00Z"),
        d("2026-09-01T15:00:00Z"),
        d("2026-09-01T15:00:00Z"),
        d("2026-09-01T17:00:00Z"),
      ),
    ).toBe(false);
  });

  it("detecta intervalo contido em outro", () => {
    expect(
      overlaps(
        d("2026-09-01T12:00:00Z"),
        d("2026-09-01T18:00:00Z"),
        d("2026-09-01T14:00:00Z"),
        d("2026-09-01T15:00:00Z"),
      ),
    ).toBe(true);
  });
});

describe("formatação brasileira", () => {
  it("formata data no padrão dd/mm/aaaa", () => {
    expect(formatDateBR(new Date("2026-09-01T12:00:00Z"), TZ)).toBe("01/09/2026");
  });

  it("descreve intervalo com horários", () => {
    expect(
      formatIntervalBR(
        new Date("2026-09-01T11:00:00Z"),
        new Date("2026-09-01T13:00:00Z"),
        false,
        TZ,
      ),
    ).toBe("01/09/2026, das 08:00 às 10:00");
  });

  it("descreve reserva de dia inteiro sem inventar horários", () => {
    expect(
      formatIntervalBR(
        new Date("2026-09-01T03:00:00Z"),
        new Date("2026-09-02T03:00:00Z"),
        true,
        TZ,
      ),
    ).toBe("01/09/2026 (dia inteiro)");
  });
});

describe("aritmética de datas", () => {
  it("soma e subtrai dias atravessando o mês", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("calcula diferença em dias", () => {
    expect(diffDays("2026-09-01", "2026-09-08")).toBe(7);
    expect(diffDays("2026-09-08", "2026-09-01")).toBe(-7);
    expect(diffDays("2026-09-01", "2026-09-01")).toBe(0);
  });
});
