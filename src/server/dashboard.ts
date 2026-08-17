import { prisma } from "@/lib/db";
import {
  addDays,
  formatDateBR,
  formatIntervalBR,
  parseTimeOfDay,
  todayLocal,
} from "@/lib/datetime";
import { getSettings } from "@/lib/settings";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ChargerKitStatus,
  IncidentSeverity,
  KitStatus,
  KitType,
  NotebookStatus,
  ReservationStatus,
} from "@/generated/prisma/enums";
import {
  BLOCKING_STATUSES,
  RESERVATION_STATUS_LABEL,
} from "./reservation-policy";
import { KIT_STATUS_LABEL } from "./resources";
import {
  CHARGER_KIT_STATUS_LABEL,
  INCIDENT_SEVERITY_LABEL,
  OPEN_INCIDENT_STATUSES,
} from "./reports";

/**
 * Painel da supervisão.
 *
 * Uma única chamada devolve tudo o que a tela inicial mostra. As consultas são
 * disparadas em paralelo e cruzadas em memória, em vez de uma consulta por
 * card: o painel é a página mais acessada do sistema e precisa responder em uma
 * ida ao banco, não em vinte.
 *
 * Nenhum dado pessoal além do nome do professor sai daqui — telefone e e-mail
 * ficam fora, e a disponibilidade de WhatsApp aparece apenas como booleano.
 */

/** Janela do bloco "próximas reservas". */
const JANELA_PROXIMAS_DIAS = 7;
/** Janela dos indicadores de utilização dos kits. */
const JANELA_UTILIZACAO_DIAS = 30;
/**
 * Teto da lista de devoluções pendentes.
 *
 * Uma reserva que ninguém encerrou continua "atrasada" para sempre: sem teto,
 * esta consulta cresceria indefinidamente com o passar dos anos e o painel — a
 * página mais acessada do sistema — carregaria o histórico inteiro a cada
 * acesso. A lista traz as mais antigas primeiro; o total real vem de um
 * `count` e continua exato em `indicadores.devolucoesPendentes`.
 */
const MAX_ALERTAS_DEVOLUCAO = 100;

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export type ResumoReserva = {
  id: string;
  code: string;
  status: ReservationStatus;
  statusLabel: string;
  data: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  periodoFormatado: string;
  room: string | null;
  purpose: string | null;
  className: string | null;
  professor: { id: string; fullName: string };
  recursos: string[];
};

export type KitEmUso = {
  kitId: string;
  code: string;
  name: string;
  type: KitType;
  reservationId: string;
  reservationCode: string;
  professor: { id: string; fullName: string };
  periodoFormatado: string;
  startsAt: string;
  endsAt: string;
  room: string | null;
};

export type NivelAlerta = "ATENCAO" | "ALTO" | "CRITICO";

export type AlertaDevolucaoPendente = {
  reservationId: string;
  code: string;
  professor: { id: string; fullName: string };
  /** Só indica se há contato autorizado; o número nunca sai da API. */
  contatoWhatsappDisponivel: boolean;
  periodoFormatado: string;
  atrasoHoras: number;
  nivel: NivelAlerta;
  recursos: string[];
  mensagem: string;
};

export type CarregadorIncompleto = {
  chargerKitId: string;
  code: string;
  kitId: string | null;
  kitName: string | null;
  status: ChargerKitStatus;
  statusLabel: string;
  totalQuantity: number;
  availableQuantity: number;
  faltando: number;
  missingParts: string | null;
};

export type UtilizacaoKit = {
  kitId: string;
  code: string;
  name: string;
  type: KitType;
  status: KitStatus;
  statusLabel: string;
  reservas: number;
  diasUtilizados: number;
  horasOcupadas: number;
  /** Fração 0..1 dos dias da janela em que o kit foi usado ao menos uma vez. */
  taxaUso: number;
  ultimaReserva: string | null;
};

export type ContagemPorSeveridade = {
  severidade: IncidentSeverity;
  label: string;
  total: number;
};

export type DashboardResult = {
  geradoEm: string;
  hoje: string;
  reservasHoje: ResumoReserva[];
  reservasProximas: ResumoReserva[];
  /** Limitada a `MAX_ALERTAS_DEVOLUCAO`; o total exato fica nos indicadores. */
  reservasAtrasadas: ResumoReserva[];
  kitsEmUso: KitEmUso[];
  notebooksPorStatus: {
    porStatus: Record<NotebookStatus, number>;
    disponiveis: number;
    reservados: number;
    emManutencao: number;
    indisponiveis: number;
    total: number;
  };
  kitsPorStatus: {
    porStatus: Record<KitStatus, number>;
    disponiveis: number;
    emManutencao: number;
    indisponiveis: number;
    desativados: number;
    total: number;
  };
  ocorrenciasAbertas: {
    total: number;
    porSeveridade: ContagemPorSeveridade[];
  };
  /** Limitada a `MAX_ALERTAS_DEVOLUCAO`; o total exato fica nos indicadores. */
  alertasDevolucaoPendente: AlertaDevolucaoPendente[];
  carregadoresIncompletos: CarregadorIncompleto[];
  utilizacaoKits: {
    janelaDias: number;
    itens: UtilizacaoKit[];
    totalReservas: number;
    taxaUsoMedia: number;
  };
  indicadores: {
    reservasHoje: number;
    reservasProximas: number;
    devolucoesPendentes: number;
    ocorrenciasAbertas: number;
    kitsEmUso: number;
    carregadoresIncompletos: number;
  };
};

// ---------------------------------------------------------------------------
// Seleções compartilhadas
// ---------------------------------------------------------------------------

/**
 * `phone`/`whatsappOptIn` entram na consulta apenas para derivar o booleano de
 * contato dos alertas — o mapeamento abaixo nunca copia o telefone para a
 * resposta.
 */
const resumoInclude = {
  user: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      whatsappOptIn: true,
    },
  },
  items: {
    select: {
      type: true,
      kit: { select: { id: true, code: true, name: true } },
      notebook: { select: { id: true, assetTag: true, nickname: true } },
    },
  },
} satisfies Prisma.ReservationInclude;

type ReservaComRelacoes = Prisma.ReservationGetPayload<{
  include: typeof resumoInclude;
}>;

function rotuloRecurso(item: ReservaComRelacoes["items"][number]): string {
  if (item.kit) return `${item.kit.name} (${item.kit.code})`;
  if (item.notebook) {
    return `Notebook ${item.notebook.assetTag}${item.notebook.nickname ? ` — ${item.notebook.nickname}` : ""}`;
  }
  return "Recurso removido";
}

function mapResumoReserva(reserva: ReservaComRelacoes): ResumoReserva {
  return {
    id: reserva.id,
    code: reserva.code,
    status: reserva.status,
    statusLabel: RESERVATION_STATUS_LABEL[reserva.status],
    data: reserva.date.toISOString().slice(0, 10),
    startsAt: reserva.startsAt.toISOString(),
    endsAt: reserva.endsAt.toISOString(),
    allDay: reserva.allDay,
    periodoFormatado: formatIntervalBR(
      reserva.startsAt,
      reserva.endsAt,
      reserva.allDay,
    ),
    room: reserva.room,
    purpose: reserva.purpose,
    className: reserva.className,
    professor: { id: reserva.user.id, fullName: reserva.user.fullName },
    recursos: reserva.items.map(rotuloRecurso),
  };
}

/**
 * Gravidade do atraso na devolução.
 *
 * Os cortes são operacionais: até 2 h ainda cabe na troca de turno; passando de
 * um dia, o equipamento provavelmente foi levado para casa e a supervisão
 * precisa agir.
 */
function nivelDoAtraso(horas: number): NivelAlerta {
  if (horas >= 24) return "CRITICO";
  if (horas >= 2) return "ALTO";
  return "ATENCAO";
}

function descreveAtraso(horas: number): string {
  if (horas < 1) return "menos de 1 hora";
  if (horas < 24) return `${Math.floor(horas)} hora(s)`;
  const dias = Math.floor(horas / 24);
  return `${dias} dia(s)`;
}

/** Contagem completa a partir de um groupBy, com zero nas chaves ausentes. */
function contagemPorStatus<S extends string>(
  todos: readonly S[],
  grupos: { status: S; _count: { _all: number } }[],
): Record<S, number> {
  const base = Object.fromEntries(todos.map((s) => [s, 0])) as Record<S, number>;
  for (const grupo of grupos) base[grupo.status] = grupo._count._all;
  return base;
}

const TODOS_STATUS_NOTEBOOK: readonly NotebookStatus[] = [
  "DISPONIVEL",
  "RESERVADO",
  "EM_USO",
  "MANUTENCAO",
  "PERDIDO",
  "INDISPONIVEL",
  "DESATIVADO",
];

const TODOS_STATUS_KIT: readonly KitStatus[] = [
  "DISPONIVEL",
  "MANUTENCAO",
  "INDISPONIVEL",
  "DESATIVADO",
];

const TODAS_SEVERIDADES: readonly IncidentSeverity[] = [
  "CRITICA",
  "ALTA",
  "MEDIA",
  "BAIXA",
];

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export async function getDashboard(): Promise<DashboardResult> {
  const agora = new Date();
  const hoje = todayLocal();
  // A coluna `date` é DATE puro: comparamos com a meia-noite UTC do dia civil,
  // sem deslocar por fuso — é assim que a reserva foi gravada.
  const hojeCivil = new Date(`${hoje}T00:00:00Z`);
  const limiteProximas = new Date(
    `${addDays(hoje, JANELA_PROXIMAS_DIAS)}T00:00:00Z`,
  );
  const inicioUtilizacao = new Date(
    agora.getTime() - JANELA_UTILIZACAO_DIAS * 86_400_000,
  );

  // Devoluções pendentes: o período terminou e a reserva ainda ocupa o recurso.
  const ondeAtrasadas: Prisma.ReservationWhereInput = {
    status: { in: BLOCKING_STATUSES },
    endsAt: { lt: agora },
  };

  const [
    reservasHojeRaw,
    reservasProximasRaw,
    reservasAtrasadasRaw,
    totalDevolucoesPendentes,
    kitsEmUsoRaw,
    gruposNotebook,
    gruposKit,
    gruposSeveridade,
    carregadoresRaw,
    itensUtilizacao,
    kitsAtivos,
    settings,
  ] = await Promise.all([
    // Agenda do dia: canceladas só poluiriam o quadro do balcão.
    prisma.reservation.findMany({
      where: { date: hojeCivil, status: { not: "CANCELADA" } },
      include: resumoInclude,
      orderBy: [{ startsAt: "asc" }],
    }),
    prisma.reservation.findMany({
      where: {
        date: { gt: hojeCivil, lte: limiteProximas },
        status: { in: BLOCKING_STATUSES },
      },
      include: resumoInclude,
      orderBy: [{ startsAt: "asc" }],
    }),
    prisma.reservation.findMany({
      where: ondeAtrasadas,
      include: resumoInclude,
      orderBy: [{ endsAt: "asc" }],
      take: MAX_ALERTAS_DEVOLUCAO,
    }),
    prisma.reservation.count({ where: ondeAtrasadas }),
    prisma.reservationItem.findMany({
      where: {
        type: "KIT",
        blocking: true,
        startsAt: { lte: agora },
        endsAt: { gt: agora },
        reservation: { status: { in: BLOCKING_STATUSES } },
      },
      select: {
        kit: { select: { id: true, code: true, name: true, type: true } },
        reservation: {
          select: {
            id: true,
            code: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            room: true,
            user: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: { endsAt: "asc" },
    }),
    prisma.notebook.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.kit.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.incident.groupBy({
      by: ["severity"],
      where: { status: { in: OPEN_INCIDENT_STATUSES } },
      _count: { _all: true },
    }),
    // Carregador incompleto = marcado como tal OU com peça faltando no estoque.
    // A comparação entre colunas usa referência de campo do Prisma, evitando
    // carregar a tabela inteira só para filtrar em memória.
    prisma.chargerKit.findMany({
      where: {
        status: { not: "DESATIVADO" },
        OR: [
          { status: "INCOMPLETO" },
          {
            availableQuantity: {
              lt: prisma.chargerKit.fields.totalQuantity,
            },
          },
        ],
      },
      select: {
        id: true,
        code: true,
        kitId: true,
        status: true,
        totalQuantity: true,
        availableQuantity: true,
        missingParts: true,
        kit: { select: { name: true } },
      },
      orderBy: { code: "asc" },
    }),
    prisma.reservationItem.findMany({
      where: {
        type: "KIT",
        startsAt: { lt: agora },
        endsAt: { gt: inicioUtilizacao },
        reservation: {
          status: { notIn: ["CANCELADA", "NAO_COMPARECEU"] },
        },
      },
      select: {
        kitId: true,
        reservationId: true,
        startsAt: true,
        endsAt: true,
        reservation: { select: { allDay: true, date: true } },
      },
    }),
    prisma.kit.findMany({
      where: { status: { not: "DESATIVADO" } },
      select: { id: true, code: true, name: true, type: true, status: true },
      orderBy: { name: "asc" },
    }),
    getSettings(),
  ]);

  // --- Reservas -----------------------------------------------------------
  const reservasHoje = reservasHojeRaw.map(mapResumoReserva);
  const reservasProximas = reservasProximasRaw.map(mapResumoReserva);
  const reservasAtrasadas = reservasAtrasadasRaw.map(mapResumoReserva);

  const alertasDevolucaoPendente: AlertaDevolucaoPendente[] =
    reservasAtrasadasRaw.map((reserva) => {
      const atrasoHoras = (agora.getTime() - reserva.endsAt.getTime()) / 3_600_000;
      const nivel = nivelDoAtraso(atrasoHoras);
      return {
        reservationId: reserva.id,
        code: reserva.code,
        professor: { id: reserva.user.id, fullName: reserva.user.fullName },
        contatoWhatsappDisponivel:
          reserva.user.whatsappOptIn && Boolean(reserva.user.phone),
        periodoFormatado: formatIntervalBR(
          reserva.startsAt,
          reserva.endsAt,
          reserva.allDay,
        ),
        atrasoHoras: Math.round(atrasoHoras * 10) / 10,
        nivel,
        recursos: reserva.items.map(rotuloRecurso),
        mensagem: `Devolução pendente há ${descreveAtraso(atrasoHoras)} — reserva ${reserva.code} de ${reserva.user.fullName}.`,
      };
    });

  // --- Kits em uso agora --------------------------------------------------
  const kitsEmUso: KitEmUso[] = kitsEmUsoRaw
    // Item sem kit é resíduo de recurso removido; não há o que exibir.
    .filter((item): item is typeof item & { kit: NonNullable<typeof item.kit> } =>
      Boolean(item.kit),
    )
    .map((item) => ({
      kitId: item.kit.id,
      code: item.kit.code,
      name: item.kit.name,
      type: item.kit.type,
      reservationId: item.reservation.id,
      reservationCode: item.reservation.code,
      professor: {
        id: item.reservation.user.id,
        fullName: item.reservation.user.fullName,
      },
      periodoFormatado: formatIntervalBR(
        item.reservation.startsAt,
        item.reservation.endsAt,
        item.reservation.allDay,
      ),
      startsAt: item.reservation.startsAt.toISOString(),
      endsAt: item.reservation.endsAt.toISOString(),
      room: item.reservation.room,
    }));

  // --- Inventário ---------------------------------------------------------
  const notebooksPorStatus = contagemPorStatus(
    TODOS_STATUS_NOTEBOOK,
    gruposNotebook,
  );
  const kitsPorStatusMapa = contagemPorStatus(TODOS_STATUS_KIT, gruposKit);

  const totalNotebooks = TODOS_STATUS_NOTEBOOK.reduce(
    (soma, status) => soma + notebooksPorStatus[status],
    0,
  );
  const totalKits = TODOS_STATUS_KIT.reduce(
    (soma, status) => soma + kitsPorStatusMapa[status],
    0,
  );

  // --- Ocorrências --------------------------------------------------------
  const severidadeMapa = new Map(
    gruposSeveridade.map((g) => [g.severity, g._count._all]),
  );
  const porSeveridade: ContagemPorSeveridade[] = TODAS_SEVERIDADES.map(
    (severidade) => ({
      severidade,
      label: INCIDENT_SEVERITY_LABEL[severidade],
      total: severidadeMapa.get(severidade) ?? 0,
    }),
  );
  const ocorrenciasAbertasTotal = porSeveridade.reduce(
    (soma, item) => soma + item.total,
    0,
  );

  // --- Carregadores -------------------------------------------------------
  const carregadoresIncompletos: CarregadorIncompleto[] = carregadoresRaw.map(
    (carregador) => ({
      chargerKitId: carregador.id,
      code: carregador.code,
      kitId: carregador.kitId,
      kitName: carregador.kit?.name ?? null,
      status: carregador.status,
      statusLabel: CHARGER_KIT_STATUS_LABEL[carregador.status],
      totalQuantity: carregador.totalQuantity,
      availableQuantity: carregador.availableQuantity,
      faltando: Math.max(
        0,
        carregador.totalQuantity - carregador.availableQuantity,
      ),
      missingParts: carregador.missingParts,
    }),
  );

  // --- Utilização dos kits ------------------------------------------------
  const abertura = parseTimeOfDay(settings.openingTime);
  const fechamento = parseTimeOfDay(settings.closingTime);
  const minutosOperacionais =
    fechamento.hour * 60 + fechamento.minute - (abertura.hour * 60 + abertura.minute);
  const horasPorDia = minutosOperacionais > 0 ? minutosOperacionais / 60 : 24;

  type Acumulado = {
    reservas: Set<string>;
    dias: Set<string>;
    horas: number;
    ultima: Date | null;
  };
  const utilizacaoPorKit = new Map<string, Acumulado>();

  for (const item of itensUtilizacao) {
    if (!item.kitId) continue;
    const atual = utilizacaoPorKit.get(item.kitId) ?? {
      reservas: new Set<string>(),
      dias: new Set<string>(),
      horas: 0,
      ultima: null,
    };

    atual.reservas.add(item.reservationId);
    atual.dias.add(item.reservation.date.toISOString().slice(0, 10));

    const inicio = Math.max(item.startsAt.getTime(), inicioUtilizacao.getTime());
    const fim = Math.min(item.endsAt.getTime(), agora.getTime());
    if (fim > inicio) {
      const horasBrutas = (fim - inicio) / 3_600_000;
      // Reserva de dia inteiro vale as horas de funcionamento, não 24 h.
      atual.horas += item.reservation.allDay
        ? (horasBrutas / 24) * horasPorDia
        : horasBrutas;
    }
    if (!atual.ultima || atual.ultima < item.startsAt) atual.ultima = item.startsAt;

    utilizacaoPorKit.set(item.kitId, atual);
  }

  /**
   * A taxa de uso é medida em dias, não em horas: "o carrinho A rodou em 18 dos
   * últimos 30 dias" é o número que a supervisão usa para decidir remanejar
   * equipamento, e não depende de quanto tempo cada aula durou.
   */
  const itensUtilizacaoKits: UtilizacaoKit[] = kitsAtivos
    .map((kit) => {
      const dados = utilizacaoPorKit.get(kit.id);
      const diasUtilizados = dados?.dias.size ?? 0;
      return {
        kitId: kit.id,
        code: kit.code,
        name: kit.name,
        type: kit.type,
        status: kit.status,
        statusLabel: KIT_STATUS_LABEL[kit.status],
        reservas: dados?.reservas.size ?? 0,
        diasUtilizados,
        horasOcupadas: Math.round((dados?.horas ?? 0) * 10) / 10,
        taxaUso:
          Math.round((diasUtilizados / JANELA_UTILIZACAO_DIAS) * 1000) / 1000,
        ultimaReserva: dados?.ultima ? formatDateBR(dados.ultima) : null,
      };
    })
    .sort(
      (a, b) =>
        b.reservas - a.reservas ||
        b.horasOcupadas - a.horasOcupadas ||
        a.name.localeCompare(b.name, "pt-BR"),
    );

  const totalReservasKits = new Set(
    itensUtilizacao.map((item) => item.reservationId),
  ).size;
  const taxaUsoMedia = itensUtilizacaoKits.length
    ? Math.round(
        (itensUtilizacaoKits.reduce((soma, k) => soma + k.taxaUso, 0) /
          itensUtilizacaoKits.length) *
          1000,
      ) / 1000
    : 0;

  return {
    geradoEm: agora.toISOString(),
    hoje,
    reservasHoje,
    reservasProximas,
    reservasAtrasadas,
    kitsEmUso,
    notebooksPorStatus: {
      porStatus: notebooksPorStatus,
      disponiveis: notebooksPorStatus.DISPONIVEL,
      // "Reservado" e "em uso" descrevem o mesmo estado do ponto de vista de
      // quem olha o painel: o equipamento está comprometido agora.
      reservados: notebooksPorStatus.RESERVADO + notebooksPorStatus.EM_USO,
      emManutencao: notebooksPorStatus.MANUTENCAO,
      indisponiveis:
        notebooksPorStatus.INDISPONIVEL +
        notebooksPorStatus.PERDIDO +
        notebooksPorStatus.DESATIVADO,
      total: totalNotebooks,
    },
    kitsPorStatus: {
      porStatus: kitsPorStatusMapa,
      disponiveis: kitsPorStatusMapa.DISPONIVEL,
      emManutencao: kitsPorStatusMapa.MANUTENCAO,
      indisponiveis: kitsPorStatusMapa.INDISPONIVEL,
      desativados: kitsPorStatusMapa.DESATIVADO,
      total: totalKits,
    },
    ocorrenciasAbertas: {
      total: ocorrenciasAbertasTotal,
      porSeveridade,
    },
    alertasDevolucaoPendente,
    carregadoresIncompletos,
    utilizacaoKits: {
      janelaDias: JANELA_UTILIZACAO_DIAS,
      itens: itensUtilizacaoKits,
      totalReservas: totalReservasKits,
      taxaUsoMedia,
    },
    indicadores: {
      reservasHoje: reservasHoje.length,
      reservasProximas: reservasProximas.length,
      // Contagem real, independente do teto aplicado à lista de alertas.
      devolucoesPendentes: totalDevolucoesPendentes,
      ocorrenciasAbertas: ocorrenciasAbertasTotal,
      kitsEmUso: kitsEmUso.length,
      carregadoresIncompletos: carregadoresIncompletos.length,
    },
  };
}
