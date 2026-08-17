import { getEnv } from "./env";

/**
 * Conversões entre o "horário de parede" da instituição e instantes UTC.
 *
 * Regra do sistema: o usuário sempre informa data/hora no fuso da instituição
 * (`INSTITUTION_TIMEZONE`); o banco sempre guarda `timestamptz` em UTC. Toda a
 * checagem de conflito trabalha em UTC, o que evita ambiguidade em mudanças de
 * fuso e mantém as comparações corretas em SQL.
 *
 * Implementado com `Intl` (sem dependência externa): descobrimos o offset real
 * do fuso no instante em questão e ajustamos. Funciona mesmo em fusos com
 * horário de verão, embora o Brasil não adote DST desde 2019.
 */

export function institutionTimeZone(): string {
  return getEnv().INSTITUTION_TIMEZONE;
}

/** Offset do fuso (ms) vigente no instante `date`. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }

  const asUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour! % 24,
    parts.minute!,
    parts.second!,
  );

  return asUtc - date.getTime();
}

/**
 * Converte um horário de parede local para o instante UTC correspondente.
 * Faz duas passadas para acertar o offset em bordas de horário de verão.
 */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  timeZone = institutionTimeZone(),
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess = new Date(naive - timeZoneOffsetMs(new Date(naive), timeZone));
  const offset = timeZoneOffsetMs(firstGuess, timeZone);
  return new Date(naive - offset);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export function parseDateOnly(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const m = DATE_RE.exec(value);
  if (!m) throw new Error(`Data inválida: "${value}" (esperado AAAA-MM-DD)`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Data inexistente no calendário: "${value}"`);
  }
  return { year, month, day };
}

export function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const m = TIME_RE.exec(value);
  if (!m) throw new Error(`Horário inválido: "${value}" (esperado HH:MM)`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`Horário inválido: "${value}"`);
  return { hour, minute };
}

/**
 * Intervalo [início, fim) em UTC para uma reserva.
 *
 * Sem horário informado, cobre o dia inteiro no fuso local — o que faz a
 * checagem de conflito tratar corretamente "reserva de dia inteiro" como
 * bloqueio do dia todo, conforme a especificação.
 */
export function reservationInterval(
  dateStr: string,
  startTime?: string | null,
  endTime?: string | null,
  timeZone = institutionTimeZone(),
): { startsAt: Date; endsAt: Date; allDay: boolean; date: Date } {
  const { year, month, day } = parseDateOnly(dateStr);
  const dayStart = zonedToUtc(year, month, day, 0, 0, timeZone);
  // A coluna `date` é do tipo DATE: guardamos o dia civil puro, sem deslocar
  // por fuso, para que a data gravada seja sempre a que o usuário escolheu.
  const civilDate = new Date(Date.UTC(year, month - 1, day));

  if (!startTime || !endTime) {
    // Dia inteiro: 00:00 local até 00:00 local do dia seguinte.
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    const dayEnd = zonedToUtc(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      0,
      0,
      timeZone,
    );
    return { startsAt: dayStart, endsAt: dayEnd, allDay: true, date: civilDate };
  }

  const start = parseTimeOfDay(startTime);
  const end = parseTimeOfDay(endTime);
  const startsAt = zonedToUtc(year, month, day, start.hour, start.minute, timeZone);
  const endsAt = zonedToUtc(year, month, day, end.hour, end.minute, timeZone);

  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error("O horário final deve ser depois do horário inicial.");
  }

  return { startsAt, endsAt, allDay: false, date: civilDate };
}

/** Limites [início, fim) em UTC de um dia local. */
export function dayBounds(
  dateStr: string,
  timeZone = institutionTimeZone(),
): { start: Date; end: Date } {
  const { startsAt, endsAt } = reservationInterval(dateStr, null, null, timeZone);
  return { start: startsAt, end: endsAt };
}

/** "AAAA-MM-DD" do dia local correspondente a um instante. */
export function toLocalDateString(
  date: Date,
  timeZone = institutionTimeZone(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "HH:MM" local. */
export function toLocalTimeString(
  date: Date,
  timeZone = institutionTimeZone(),
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Data no padrão brasileiro: 17/08/2026. */
export function formatDateBR(
  date: Date,
  timeZone = institutionTimeZone(),
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Data e hora: 17/08/2026 às 14:30. */
export function formatDateTimeBR(
  date: Date,
  timeZone = institutionTimeZone(),
): string {
  return `${formatDateBR(date, timeZone)} às ${toLocalTimeString(date, timeZone)}`;
}

/** Descrição do intervalo, já ciente de reservas de dia inteiro. */
export function formatIntervalBR(
  startsAt: Date,
  endsAt: Date,
  allDay: boolean,
  timeZone = institutionTimeZone(),
): string {
  const date = formatDateBR(startsAt, timeZone);
  if (allDay) return `${date} (dia inteiro)`;
  return `${date}, das ${toLocalTimeString(startsAt, timeZone)} às ${toLocalTimeString(endsAt, timeZone)}`;
}

/** Hoje no fuso da instituição, como "AAAA-MM-DD". */
export function todayLocal(timeZone = institutionTimeZone()): string {
  return toLocalDateString(new Date(), timeZone);
}

/** Soma dias a uma data "AAAA-MM-DD" mantendo o formato. */
export function addDays(dateStr: string, days: number): string {
  const { year, month, day } = parseDateOnly(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

/** Diferença em dias inteiros entre duas datas locais. */
export function diffDays(fromDateStr: string, toDateStr: string): number {
  const a = parseDateOnly(fromDateStr);
  const b = parseDateOnly(toDateStr);
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((msB - msA) / 86_400_000);
}

/** Dois intervalos [início, fim) se sobrepõem? */
export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}
