import { prisma } from "@/lib/db";
import { dadosInvalidos } from "@/lib/errors";
import {
  addDays,
  dayBounds,
  formatDateBR,
  formatDateTimeBR,
  formatIntervalBR,
  parseTimeOfDay,
  todayLocal,
} from "@/lib/datetime";
import { getSettings } from "@/lib/settings";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ChargerKitStatus,
  IncidentCategory,
  IncidentSeverity,
  IncidentStatus,
  KitStatus,
  NotebookStatus,
  ReservationStatus,
} from "@/generated/prisma/enums";
import { KIT_STATUS_LABEL, NOTEBOOK_STATUS_LABEL } from "./resources";
import { RESERVATION_STATUS_LABEL } from "./reservation-policy";

/**
 * Relatórios da supervisão.
 *
 * Todo relatório devolve a mesma estrutura (`ReportResult`): colunas rotuladas
 * + linhas planas. A tela monta a tabela a partir daí e a exportação CSV usa
 * exatamente os mesmos dados — assim o que o supervisor vê na tela é o que sai
 * no arquivo, sem uma segunda implementação para divergir com o tempo.
 *
 * Este módulo também concentra os rótulos de ocorrência e de carregadores, que
 * ainda não existem em outro lugar do servidor; o painel importa daqui para não
 * duplicar as traduções.
 */

// ---------------------------------------------------------------------------
// Vocabulário compartilhado
// ---------------------------------------------------------------------------

export const INCIDENT_CATEGORY_LABEL: Record<IncidentCategory, string> = {
  HARDWARE: "Hardware",
  CARREGADOR: "Carregador",
  BATERIA: "Bateria",
  TELA: "Tela",
  TECLADO: "Teclado",
  TOUCHPAD: "Touchpad",
  REDE: "Rede/Wi-Fi",
  SISTEMA: "Sistema operacional",
  SOFTWARE: "Software",
  DANO_FISICO: "Dano físico",
  LIMPEZA: "Limpeza",
  ACESSORIO_AUSENTE: "Acessório ausente",
  DEVOLUCAO_INCOMPLETA: "Devolução incompleta",
  NOTEBOOK_FALTANTE: "Notebook faltante",
  CARREGADOR_FALTANTE: "Carregador faltante",
  OUTRO: "Outro",
};

export const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
  CRITICA: "Crítica",
};

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  ABERTA: "Aberta",
  EM_ANALISE: "Em análise",
  EM_MANUTENCAO: "Em manutenção",
  RESOLVIDA: "Resolvida",
  DESCARTADA: "Descartada",
  RECORRENTE: "Recorrente",
};

export const CHARGER_KIT_STATUS_LABEL: Record<ChargerKitStatus, string> = {
  COMPLETO: "Completo",
  INCOMPLETO: "Incompleto",
  MANUTENCAO: "Em manutenção",
  INDISPONIVEL: "Indisponível",
  DESATIVADO: "Desativado",
};

/**
 * Ocorrências que ainda demandam ação.
 * `RECORRENTE` entra aqui porque descreve um problema que voltou a acontecer e
 * continua pendente — resolvido de fato é só `RESOLVIDA` ou `DESCARTADA`.
 */
export const OPEN_INCIDENT_STATUSES: IncidentStatus[] = [
  "ABERTA",
  "EM_ANALISE",
  "EM_MANUTENCAO",
  "RECORRENTE",
];

/** Status de kit que tiram o recurso de circulação. */
export const UNAVAILABLE_KIT_STATUSES: KitStatus[] = [
  "MANUTENCAO",
  "INDISPONIVEL",
  "DESATIVADO",
];

export const UNAVAILABLE_NOTEBOOK_STATUSES: NotebookStatus[] = [
  "MANUTENCAO",
  "PERDIDO",
  "INDISPONIVEL",
  "DESATIVADO",
];

export const UNAVAILABLE_CHARGER_KIT_STATUSES: ChargerKitStatus[] = [
  "INCOMPLETO",
  "MANUTENCAO",
  "INDISPONIVEL",
  "DESATIVADO",
];

/**
 * Status que não representam uso real do equipamento.
 *
 * Uma reserva cancelada nunca ocupou o recurso, e um não comparecimento
 * significa que ninguém retirou nada. Contá-las inflaria a taxa de utilização e
 * levaria a supervisão a comprar equipamento que não falta.
 */
const NON_USAGE_STATUSES: ReservationStatus[] = ["CANCELADA", "NAO_COMPARECEU"];

// ---------------------------------------------------------------------------
// Estrutura comum dos relatórios
// ---------------------------------------------------------------------------

export type ReportColumn = {
  chave: string;
  rotulo: string;
  /** Dica de alinhamento/formatação para a tabela na tela. */
  tipo?: "texto" | "numero" | "data" | "percentual";
};

export type ReportTable = {
  titulo: string;
  colunas: ReportColumn[];
  linhas: Record<string, unknown>[];
};

export const REPORT_TYPES = [
  "utilizacao",
  "professores",
  "ocorrencias",
  "conflitos",
  "indisponiveis",
  "historico",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export type ReportPeriod = {
  from: string;
  to: string;
  inicio: Date;
  fim: Date;
  formatado: string;
};

export type ReportResult = ReportTable & {
  tipo: ReportType;
  periodo: ReportPeriod | null;
  geradoEm: string;
  resumo: Record<string, unknown>;
  /** Recortes adicionais do mesmo relatório (ex.: ocorrências por categoria). */
  tabelasExtras: ReportTable[];
};

const JANELA_PADRAO_DIAS = 30;

/**
 * Resolve o período do relatório.
 *
 * Sem datas informadas usamos os últimos 30 dias: é a janela que a supervisão
 * consulta no dia a dia e evita que um relatório sem filtro varra o histórico
 * inteiro da instituição.
 */
export function resolvePeriodo(
  from?: string | null,
  to?: string | null,
): ReportPeriod {
  const hoje = todayLocal();
  const inicioStr = from ?? addDays(hoje, -JANELA_PADRAO_DIAS);
  const fimStr = to ?? hoje;

  if (inicioStr > fimStr) {
    throw dadosInvalidos("A data inicial deve ser anterior à data final.", {
      from: ["A data inicial deve ser anterior à data final."],
    });
  }

  const { start } = dayBounds(inicioStr);
  const { end } = dayBounds(fimStr);

  return {
    from: inicioStr,
    to: fimStr,
    inicio: start,
    fim: end,
    formatado:
      inicioStr === fimStr
        ? formatDateBR(start)
        : `${formatDateBR(start)} a ${formatDateBR(new Date(end.getTime() - 1))}`,
  };
}

/** Minutos de funcionamento por dia, conforme as configurações vigentes. */
async function horasOperacionaisPorDia(): Promise<number> {
  const settings = await getSettings();
  const abertura = parseTimeOfDay(settings.openingTime);
  const fechamento = parseTimeOfDay(settings.closingTime);
  const minutos =
    fechamento.hour * 60 + fechamento.minute - (abertura.hour * 60 + abertura.minute);
  // Configuração incoerente (fechamento antes da abertura) não pode zerar a
  // divisão da taxa de uso; caímos no dia inteiro nesse caso.
  return minutos > 0 ? minutos / 60 : 24;
}

/**
 * Horas de ocupação de um item dentro da janela consultada.
 *
 * Reservas de dia inteiro contam apenas as horas de funcionamento da
 * instituição: contar 24 h faria uma única reserva de dia inteiro parecer três
 * vezes mais uso do que realmente houve.
 */
function horasNaJanela(
  startsAt: Date,
  endsAt: Date,
  allDay: boolean,
  janelaInicio: Date,
  janelaFim: Date,
  horasPorDia: number,
): number {
  const inicio = Math.max(startsAt.getTime(), janelaInicio.getTime());
  const fim = Math.min(endsAt.getTime(), janelaFim.getTime());
  if (fim <= inicio) return 0;

  const horasBrutas = (fim - inicio) / 3_600_000;
  if (!allDay) return horasBrutas;
  return (horasBrutas / 24) * horasPorDia;
}

const arredonda = (valor: number, casas = 2): number => {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
};

// ---------------------------------------------------------------------------
// Exportação CSV
// ---------------------------------------------------------------------------

const CSV_SEPARATOR = ";";

/**
 * Neutraliza fórmulas do Excel.
 *
 * Um valor de texto começando com `=`, `+`, `-` ou `@` é interpretado como
 * fórmula ao abrir o arquivo. Como o conteúdo vem de campos digitados por
 * usuários (finalidade, observações), prefixamos um apóstrofo, que o Excel
 * consome ao exibir. Números não passam por aqui, então "-5" continua -5.
 */
function neutralizaFormula(texto: string): string {
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let texto: string;
  if (value instanceof Date) {
    texto = formatDateTimeBR(value);
  } else if (typeof value === "number") {
    // Excel em pt-BR espera vírgula como separador decimal.
    texto = Number.isInteger(value)
      ? String(value)
      : String(value).replace(".", ",");
  } else if (typeof value === "boolean") {
    texto = value ? "Sim" : "Não";
  } else if (Array.isArray(value)) {
    texto = value.map((item) => String(item)).join(", ");
  } else if (typeof value === "object") {
    texto = JSON.stringify(value);
  } else {
    texto = neutralizaFormula(String(value));
  }

  // Aspas duplicadas e envelope de aspas sempre que houver separador, aspas ou
  // quebra de linha — é o que faz o Excel manter a célula inteira.
  const precisaAspas = /[";\n\r]/.test(texto);
  const escapado = texto.replace(/"/g, '""');
  return precisaAspas ? `"${escapado}"` : escapado;
}

/**
 * Converte linhas em CSV com `;` como separador — o padrão que o Excel em
 * pt-BR abre com duplo clique, sem passar pelo assistente de importação.
 *
 * As colunas são opcionais: quando informadas, definem a ordem e os rótulos do
 * cabeçalho; sem elas, usamos as chaves na ordem em que aparecem nas linhas.
 */
export function toCsv(
  rows: Record<string, unknown>[],
  columns?: ReportColumn[],
): string {
  const chaves = columns?.length
    ? columns.map((c) => c.chave)
    : [...new Set(rows.flatMap((row) => Object.keys(row)))];

  if (chaves.length === 0) return "";

  const cabecalho = columns?.length
    ? columns.map((c) => csvCell(c.rotulo))
    : chaves.map((chave) => csvCell(chave));

  const linhas = rows.map((row) =>
    chaves.map((chave) => csvCell(row[chave])).join(CSV_SEPARATOR),
  );

  // CRLF: alguns Excel antigos no Windows ignoram LF puro na última coluna.
  return [cabecalho.join(CSV_SEPARATOR), ...linhas].join("\r\n");
}

/** CSV do relatório inteiro, incluindo os recortes adicionais. */
export function reportToCsv(report: ReportResult): string {
  const blocos: string[] = [
    report.titulo,
    report.periodo ? `Período: ${report.periodo.formatado}` : "Posição atual",
    `Gerado em: ${formatDateTimeBR(new Date(report.geradoEm))}`,
    "",
    toCsv(report.linhas, report.colunas),
  ];

  for (const extra of report.tabelasExtras) {
    blocos.push("", extra.titulo, toCsv(extra.linhas, extra.colunas));
  }

  return blocos.join("\r\n");
}

/** Nome de arquivo previsível, já ordenável por tipo e data. */
export function reportFileName(report: ReportResult): string {
  const sufixo = report.periodo
    ? `${report.periodo.from}_a_${report.periodo.to}`
    : report.geradoEm.slice(0, 10);
  return `relatorio-${report.tipo}-${sufixo}.csv`;
}

// ---------------------------------------------------------------------------
// 1. Utilização por recurso
// ---------------------------------------------------------------------------

type UtilizacaoAcumulado = {
  tipo: "Kit" | "Notebook";
  codigo: string;
  identificacao: string;
  reservas: Set<string>;
  dias: Set<string>;
  horas: number;
  ultimaReserva: Date | null;
};

/**
 * Reservas e horas ocupadas por kit e por notebook no período.
 *
 * Agregamos em memória a partir de uma única consulta de itens: o inventário de
 * uma escola tem centenas de itens e o período típico é de um mês, então uma
 * consulta por recurso (N+1) custaria muito mais do que o cruzamento local.
 */
export async function utilizationReport(
  from?: string | null,
  to?: string | null,
): Promise<ReportResult> {
  const periodo = resolvePeriodo(from, to);

  const [itens, horasPorDia] = await Promise.all([
    prisma.reservationItem.findMany({
      where: {
        startsAt: { lt: periodo.fim },
        endsAt: { gt: periodo.inicio },
        reservation: { status: { notIn: NON_USAGE_STATUSES } },
      },
      select: {
        type: true,
        kitId: true,
        notebookId: true,
        startsAt: true,
        endsAt: true,
        reservationId: true,
        kit: { select: { code: true, name: true, type: true } },
        notebook: { select: { assetTag: true, nickname: true } },
        reservation: { select: { allDay: true, date: true } },
      },
    }),
    horasOperacionaisPorDia(),
  ]);

  const porRecurso = new Map<string, UtilizacaoAcumulado>();

  for (const item of itens) {
    const chave = item.kitId
      ? `kit:${item.kitId}`
      : item.notebookId
        ? `notebook:${item.notebookId}`
        : null;
    // Item órfão (recurso removido) não tem o que ser reportado.
    if (!chave) continue;

    const atual =
      porRecurso.get(chave) ??
      ({
        tipo: item.type === "KIT" ? "Kit" : "Notebook",
        codigo: item.kit?.code ?? item.notebook?.assetTag ?? "—",
        identificacao: item.kit
          ? `${item.kit.name} (${item.kit.type === "MALETA" ? "Maleta" : "Carrinho"})`
          : (item.notebook?.nickname ?? item.notebook?.assetTag ?? "—"),
        reservas: new Set<string>(),
        dias: new Set<string>(),
        horas: 0,
        ultimaReserva: null,
      } satisfies UtilizacaoAcumulado);

    atual.reservas.add(item.reservationId);
    atual.dias.add(item.reservation.date.toISOString().slice(0, 10));
    atual.horas += horasNaJanela(
      item.startsAt,
      item.endsAt,
      item.reservation.allDay,
      periodo.inicio,
      periodo.fim,
      horasPorDia,
    );
    if (!atual.ultimaReserva || atual.ultimaReserva < item.startsAt) {
      atual.ultimaReserva = item.startsAt;
    }

    porRecurso.set(chave, atual);
  }

  const linhas = [...porRecurso.values()]
    .map((registro) => ({
      tipo: registro.tipo,
      codigo: registro.codigo,
      identificacao: registro.identificacao,
      reservas: registro.reservas.size,
      diasUtilizados: registro.dias.size,
      horasOcupadas: arredonda(registro.horas, 1),
      ultimaReserva: registro.ultimaReserva
        ? formatDateBR(registro.ultimaReserva)
        : "—",
    }))
    .sort((a, b) => b.horasOcupadas - a.horasOcupadas || b.reservas - a.reservas);

  const totalHoras = linhas.reduce((soma, l) => soma + l.horasOcupadas, 0);
  const totalReservas = new Set(itens.map((i) => i.reservationId)).size;

  return {
    tipo: "utilizacao",
    titulo: "Utilização de kits e notebooks",
    periodo,
    geradoEm: new Date().toISOString(),
    colunas: [
      { chave: "tipo", rotulo: "Tipo" },
      { chave: "codigo", rotulo: "Código/Patrimônio" },
      { chave: "identificacao", rotulo: "Identificação" },
      { chave: "reservas", rotulo: "Reservas", tipo: "numero" },
      { chave: "diasUtilizados", rotulo: "Dias utilizados", tipo: "numero" },
      { chave: "horasOcupadas", rotulo: "Horas ocupadas", tipo: "numero" },
      { chave: "ultimaReserva", rotulo: "Última reserva", tipo: "data" },
    ],
    linhas,
    resumo: {
      recursosUtilizados: linhas.length,
      totalReservas,
      totalHorasOcupadas: arredonda(totalHoras, 1),
      horasOperacionaisPorDia: arredonda(horasPorDia, 1),
      observacao:
        "Reservas canceladas e não comparecimentos não entram no cálculo de uso.",
    },
    tabelasExtras: [],
  };
}

// ---------------------------------------------------------------------------
// 2. Reservas por professor
// ---------------------------------------------------------------------------

export async function reservationsByTeacher(
  from?: string | null,
  to?: string | null,
): Promise<ReportResult> {
  const periodo = resolvePeriodo(from, to);

  const where: Prisma.ReservationWhereInput = {
    startsAt: { lt: periodo.fim },
    endsAt: { gt: periodo.inicio },
  };

  // Uma agregação por (professor, status) evita trazer as reservas inteiras.
  const grupos = await prisma.reservation.groupBy({
    by: ["userId", "status"],
    where,
    _count: { _all: true },
  });

  const userIds = [...new Set(grupos.map((g) => g.userId))];
  const usuarios = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true, department: true, active: true },
      })
    : [];
  const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));

  const statusOrdenados = Object.keys(
    RESERVATION_STATUS_LABEL,
  ) as ReservationStatus[];

  type LinhaProfessor = Record<string, unknown> & {
    professor: string;
    total: number;
  };

  const porProfessor = new Map<string, LinhaProfessor>();

  for (const grupo of grupos) {
    const usuario = usuarioPorId.get(grupo.userId);
    const linha =
      porProfessor.get(grupo.userId) ??
      ({
        professor: usuario?.fullName ?? "Professor removido",
        departamento: usuario?.department ?? "—",
        situacaoConta: usuario?.active === false ? "Desativada" : "Ativa",
        total: 0,
        ...Object.fromEntries(statusOrdenados.map((s) => [s, 0])),
      } as LinhaProfessor);

    const quantidade = grupo._count._all;
    linha[grupo.status] = (Number(linha[grupo.status]) || 0) + quantidade;
    linha.total += quantidade;
    porProfessor.set(grupo.userId, linha);
  }

  const linhas = [...porProfessor.values()].sort(
    (a, b) => b.total - a.total || a.professor.localeCompare(b.professor, "pt-BR"),
  );

  const totalReservas = linhas.reduce((soma, l) => soma + l.total, 0);

  return {
    tipo: "professores",
    titulo: "Reservas por professor",
    periodo,
    geradoEm: new Date().toISOString(),
    colunas: [
      { chave: "professor", rotulo: "Professor" },
      { chave: "departamento", rotulo: "Departamento/Disciplina" },
      { chave: "situacaoConta", rotulo: "Conta" },
      { chave: "total", rotulo: "Total", tipo: "numero" },
      ...statusOrdenados.map((status) => ({
        chave: status,
        rotulo: RESERVATION_STATUS_LABEL[status],
        tipo: "numero" as const,
      })),
    ],
    linhas,
    resumo: {
      professores: linhas.length,
      totalReservas,
      mediaPorProfessor: linhas.length
        ? arredonda(totalReservas / linhas.length, 1)
        : 0,
    },
    tabelasExtras: [],
  };
}

// ---------------------------------------------------------------------------
// 3. Ocorrências
// ---------------------------------------------------------------------------

type ContagemSimples = Map<string, number>;

function incrementa(mapa: ContagemSimples, chave: string, valor = 1): void {
  mapa.set(chave, (mapa.get(chave) ?? 0) + valor);
}

function tabelaDeContagem(
  titulo: string,
  rotuloChave: string,
  contagem: ContagemSimples,
  total: number,
): ReportTable {
  const linhas = [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([chave, quantidade]) => ({
      item: chave,
      quantidade,
      percentual: total ? `${arredonda((quantidade / total) * 100, 1)}%` : "0%",
    }));

  return {
    titulo,
    colunas: [
      { chave: "item", rotulo: rotuloChave },
      { chave: "quantidade", rotulo: "Quantidade", tipo: "numero" },
      { chave: "percentual", rotulo: "Percentual", tipo: "percentual" },
    ],
    linhas,
  };
}

export async function incidentsReport(
  from?: string | null,
  to?: string | null,
): Promise<ReportResult> {
  const periodo = resolvePeriodo(from, to);

  const ocorrencias = await prisma.incident.findMany({
    where: { createdAt: { gte: periodo.inicio, lt: periodo.fim } },
    select: {
      id: true,
      code: true,
      category: true,
      severity: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      targetType: true,
      notebookId: true,
      kitId: true,
      chargerKitId: true,
      notebook: { select: { assetTag: true, nickname: true } },
      kit: { select: { code: true, name: true } },
      chargerKit: { select: { code: true } },
      reservation: { select: { code: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const porCategoria: ContagemSimples = new Map();
  const porSeveridade: ContagemSimples = new Map();
  const porStatus: ContagemSimples = new Map();

  type LinhaRecurso = {
    recurso: string;
    tipoRecurso: string;
    total: number;
    abertas: number;
    criticas: number;
    ultimaOcorrencia: string;
  };
  const porRecurso = new Map<string, LinhaRecurso>();

  let resolvidas = 0;
  let somaHorasResolucao = 0;

  for (const oc of ocorrencias) {
    incrementa(porCategoria, INCIDENT_CATEGORY_LABEL[oc.category]);
    incrementa(porSeveridade, INCIDENT_SEVERITY_LABEL[oc.severity]);
    incrementa(porStatus, INCIDENT_STATUS_LABEL[oc.status]);

    if (oc.resolvedAt) {
      resolvidas += 1;
      somaHorasResolucao +=
        (oc.resolvedAt.getTime() - oc.createdAt.getTime()) / 3_600_000;
    }

    const { chave, recurso, tipoRecurso } = descreveAlvoOcorrencia(oc);
    const linha =
      porRecurso.get(chave) ??
      ({
        recurso,
        tipoRecurso,
        total: 0,
        abertas: 0,
        criticas: 0,
        ultimaOcorrencia: formatDateBR(oc.createdAt),
      } satisfies LinhaRecurso);

    linha.total += 1;
    if (OPEN_INCIDENT_STATUSES.includes(oc.status)) linha.abertas += 1;
    if (oc.severity === "CRITICA" || oc.severity === "ALTA") linha.criticas += 1;
    porRecurso.set(chave, linha);
  }

  const linhas = [...porRecurso.values()].sort(
    (a, b) => b.abertas - a.abertas || b.total - a.total,
  );

  const abertas = ocorrencias.filter((oc) =>
    OPEN_INCIDENT_STATUSES.includes(oc.status),
  ).length;

  return {
    tipo: "ocorrencias",
    titulo: "Ocorrências registradas",
    periodo,
    geradoEm: new Date().toISOString(),
    colunas: [
      { chave: "recurso", rotulo: "Recurso" },
      { chave: "tipoRecurso", rotulo: "Tipo" },
      { chave: "total", rotulo: "Ocorrências", tipo: "numero" },
      { chave: "abertas", rotulo: "Em aberto", tipo: "numero" },
      { chave: "criticas", rotulo: "Alta/Crítica", tipo: "numero" },
      { chave: "ultimaOcorrencia", rotulo: "Registro mais recente", tipo: "data" },
    ],
    linhas,
    resumo: {
      total: ocorrencias.length,
      abertas,
      resolvidas,
      recursosAfetados: linhas.length,
      tempoMedioResolucaoHoras: resolvidas
        ? arredonda(somaHorasResolucao / resolvidas, 1)
        : null,
    },
    tabelasExtras: [
      tabelaDeContagem(
        "Ocorrências por categoria",
        "Categoria",
        porCategoria,
        ocorrencias.length,
      ),
      tabelaDeContagem(
        "Ocorrências por severidade",
        "Severidade",
        porSeveridade,
        ocorrencias.length,
      ),
      tabelaDeContagem(
        "Ocorrências por situação",
        "Situação",
        porStatus,
        ocorrencias.length,
      ),
    ],
  };
}

/** Identifica de forma legível o alvo de uma ocorrência. */
function descreveAlvoOcorrencia(oc: {
  targetType: string;
  notebookId: string | null;
  kitId: string | null;
  chargerKitId: string | null;
  notebook: { assetTag: string; nickname: string | null } | null;
  kit: { code: string; name: string } | null;
  chargerKit: { code: string } | null;
  reservation: { code: string } | null;
}): { chave: string; recurso: string; tipoRecurso: string } {
  if (oc.notebookId && oc.notebook) {
    return {
      chave: `notebook:${oc.notebookId}`,
      recurso: `${oc.notebook.assetTag}${oc.notebook.nickname ? ` — ${oc.notebook.nickname}` : ""}`,
      tipoRecurso: "Notebook",
    };
  }
  if (oc.kitId && oc.kit) {
    return {
      chave: `kit:${oc.kitId}`,
      recurso: `${oc.kit.name} (${oc.kit.code})`,
      tipoRecurso: "Kit",
    };
  }
  if (oc.chargerKitId && oc.chargerKit) {
    return {
      chave: `charger:${oc.chargerKitId}`,
      recurso: oc.chargerKit.code,
      tipoRecurso: "Kit de carregadores",
    };
  }
  if (oc.reservation) {
    return {
      chave: `reserva:${oc.reservation.code}`,
      recurso: oc.reservation.code,
      tipoRecurso: "Reserva",
    };
  }
  return { chave: "sem-recurso", recurso: "Sem recurso vinculado", tipoRecurso: "—" };
}

// ---------------------------------------------------------------------------
// 4. Conflitos e contatos de WhatsApp
// ---------------------------------------------------------------------------

/**
 * Tentativas de reserva que esbarraram em conflito, e os contatos de WhatsApp
 * gerados a partir delas.
 *
 * As tentativas vêm da trilha de auditoria: qualquer ação cujo nome contenha
 * "conflito" entra aqui, o que mantém o relatório funcionando mesmo quando o
 * fluxo de reservas registrar variações de nome ("reserva.conflito",
 * "reserva.conflito_detectado").
 *
 * Do contato de WhatsApp reportamos apenas quem pediu, para quem e quando —
 * nunca o telefone nem o texto da conversa.
 */
export async function conflictsReport(
  from?: string | null,
  to?: string | null,
): Promise<ReportResult> {
  const periodo = resolvePeriodo(from, to);

  const [tentativas, contatos] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        createdAt: { gte: periodo.inicio, lt: periodo.fim },
        action: { contains: "conflito", mode: "insensitive" },
      },
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        summary: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.whatsappContactLog.findMany({
      where: { createdAt: { gte: periodo.inicio, lt: periodo.fim } },
      select: {
        id: true,
        createdAt: true,
        requester: { select: { id: true, fullName: true } },
        targetUser: { select: { id: true, fullName: true } },
        reservation: { select: { code: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
  ]);

  const linhas = tentativas.map((registro) => ({
    dataHora: formatDateTimeBR(registro.createdAt),
    solicitante: registro.actor?.fullName ?? "—",
    acao: registro.action,
    entidade: registro.entity,
    detalhe: registro.summary ?? "—",
  }));

  const contatosLinhas = contatos.map((contato) => ({
    dataHora: formatDateTimeBR(contato.createdAt),
    solicitante: contato.requester.fullName,
    professorContatado: contato.targetUser.fullName,
    reserva: contato.reservation?.code ?? "—",
  }));

  // Quem mais recebe pedidos de compartilhamento indica onde falta equipamento.
  const contagemPorAlvo: ContagemSimples = new Map();
  for (const contato of contatos) {
    incrementa(contagemPorAlvo, contato.targetUser.fullName);
  }

  return {
    tipo: "conflitos",
    titulo: "Conflitos de reserva e contatos gerados",
    periodo,
    geradoEm: new Date().toISOString(),
    colunas: [
      { chave: "dataHora", rotulo: "Data/Hora", tipo: "data" },
      { chave: "solicitante", rotulo: "Solicitante" },
      { chave: "acao", rotulo: "Ação" },
      { chave: "entidade", rotulo: "Entidade" },
      { chave: "detalhe", rotulo: "Detalhe" },
    ],
    linhas,
    resumo: {
      tentativasComConflito: tentativas.length,
      contatosWhatsappGerados: contatos.length,
      professoresContatados: contagemPorAlvo.size,
      observacao:
        "O contato por WhatsApp registra apenas quem solicitou, para quem e quando.",
    },
    tabelasExtras: [
      {
        titulo: "Contatos de WhatsApp gerados",
        colunas: [
          { chave: "dataHora", rotulo: "Data/Hora", tipo: "data" },
          { chave: "solicitante", rotulo: "Solicitante" },
          { chave: "professorContatado", rotulo: "Professor contatado" },
          { chave: "reserva", rotulo: "Reserva" },
        ],
        linhas: contatosLinhas,
      },
      tabelaDeContagem(
        "Professores mais contatados",
        "Professor",
        contagemPorAlvo,
        contatos.length,
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// 5. Recursos indisponíveis
// ---------------------------------------------------------------------------

/**
 * Fotografia do que está fora de circulação agora.
 *
 * "Há quanto tempo" usa o `updatedAt` do próprio registro: é a última vez que o
 * cadastro mudou e, na prática, corresponde ao momento em que o recurso foi
 * marcado como indisponível. O histórico exato de cada mudança continua
 * disponível na auditoria da entidade.
 */
export async function unavailableResourcesReport(): Promise<ReportResult> {
  const agora = new Date();

  const [kits, notebooks, carregadores, ocKits, ocNotebooks, ocCarregadores] =
    await Promise.all([
      prisma.kit.findMany({
        where: { status: { in: UNAVAILABLE_KIT_STATUSES } },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          status: true,
          location: true,
          notes: true,
          updatedAt: true,
        },
      }),
      prisma.notebook.findMany({
        where: { status: { in: UNAVAILABLE_NOTEBOOK_STATUSES } },
        select: {
          id: true,
          assetTag: true,
          nickname: true,
          status: true,
          notes: true,
          updatedAt: true,
          kit: { select: { name: true } },
        },
      }),
      prisma.chargerKit.findMany({
        where: { status: { in: UNAVAILABLE_CHARGER_KIT_STATUSES } },
        select: {
          id: true,
          code: true,
          status: true,
          totalQuantity: true,
          availableQuantity: true,
          missingParts: true,
          updatedAt: true,
          kit: { select: { name: true } },
        },
      }),
      prisma.incident.groupBy({
        by: ["kitId"],
        where: { kitId: { not: null }, status: { in: OPEN_INCIDENT_STATUSES } },
        _count: { _all: true },
      }),
      prisma.incident.groupBy({
        by: ["notebookId"],
        where: { notebookId: { not: null }, status: { in: OPEN_INCIDENT_STATUSES } },
        _count: { _all: true },
      }),
      prisma.incident.groupBy({
        by: ["chargerKitId"],
        where: {
          chargerKitId: { not: null },
          status: { in: OPEN_INCIDENT_STATUSES },
        },
        _count: { _all: true },
      }),
    ]);

  /** Transforma o resultado de um groupBy em "id do recurso -> nº de ocorrências". */
  function contagemPorId<T extends { _count: { _all: number } }>(
    grupos: T[],
    idDe: (grupo: T) => string | null,
  ): Map<string, number> {
    const mapa = new Map<string, number>();
    for (const grupo of grupos) {
      const id = idDe(grupo);
      if (id) mapa.set(id, grupo._count._all);
    }
    return mapa;
  }

  const ocorrenciasKit = contagemPorId(ocKits, (g) => g.kitId);
  const ocorrenciasNotebook = contagemPorId(ocNotebooks, (g) => g.notebookId);
  const ocorrenciasCarregador = contagemPorId(ocCarregadores, (g) => g.chargerKitId);

  const diasDesde = (data: Date): number =>
    Math.max(0, Math.floor((agora.getTime() - data.getTime()) / 86_400_000));

  const linhas = [
    ...kits.map((kit) => ({
      tipo: kit.type === "MALETA" ? "Maleta" : "Carrinho",
      codigo: kit.code,
      identificacao: kit.name,
      situacao: KIT_STATUS_LABEL[kit.status],
      desde: formatDateBR(kit.updatedAt),
      diasIndisponivel: diasDesde(kit.updatedAt),
      ocorrenciasAbertas: ocorrenciasKit.get(kit.id) ?? 0,
      observacoes: kit.notes ?? kit.location ?? "—",
    })),
    ...notebooks.map((notebook) => ({
      tipo: "Notebook",
      codigo: notebook.assetTag,
      identificacao:
        notebook.nickname ??
        (notebook.kit ? `Do kit ${notebook.kit.name}` : "Avulso"),
      situacao: NOTEBOOK_STATUS_LABEL[notebook.status],
      desde: formatDateBR(notebook.updatedAt),
      diasIndisponivel: diasDesde(notebook.updatedAt),
      ocorrenciasAbertas: ocorrenciasNotebook.get(notebook.id) ?? 0,
      observacoes: notebook.notes ?? "—",
    })),
    ...carregadores.map((carregador) => ({
      tipo: "Kit de carregadores",
      codigo: carregador.code,
      identificacao: carregador.kit
        ? `Do kit ${carregador.kit.name}`
        : "Reposição avulsa",
      situacao: `${CHARGER_KIT_STATUS_LABEL[carregador.status]} (${carregador.availableQuantity}/${carregador.totalQuantity})`,
      desde: formatDateBR(carregador.updatedAt),
      diasIndisponivel: diasDesde(carregador.updatedAt),
      ocorrenciasAbertas: ocorrenciasCarregador.get(carregador.id) ?? 0,
      observacoes: carregador.missingParts ?? "—",
    })),
  ].sort((a, b) => b.diasIndisponivel - a.diasIndisponivel);

  return {
    tipo: "indisponiveis",
    titulo: "Recursos indisponíveis",
    // Retrato do momento: um período não faria sentido aqui.
    periodo: null,
    geradoEm: agora.toISOString(),
    colunas: [
      { chave: "tipo", rotulo: "Tipo" },
      { chave: "codigo", rotulo: "Código/Patrimônio" },
      { chave: "identificacao", rotulo: "Identificação" },
      { chave: "situacao", rotulo: "Situação" },
      { chave: "desde", rotulo: "Desde", tipo: "data" },
      { chave: "diasIndisponivel", rotulo: "Dias fora", tipo: "numero" },
      { chave: "ocorrenciasAbertas", rotulo: "Ocorrências abertas", tipo: "numero" },
      { chave: "observacoes", rotulo: "Observações" },
    ],
    linhas,
    resumo: {
      total: linhas.length,
      kits: kits.length,
      notebooks: notebooks.length,
      kitsDeCarregadores: carregadores.length,
      maiorTempoForaDias: linhas[0]?.diasIndisponivel ?? 0,
    },
    tabelasExtras: [],
  };
}

// ---------------------------------------------------------------------------
// 6. Histórico de reservas
// ---------------------------------------------------------------------------

export type ReservationHistoryFilters = {
  from?: string | null;
  to?: string | null;
  userId?: string;
  kitId?: string;
  notebookId?: string;
  status?: ReservationStatus[];
  search?: string;
  limit?: number;
};

/** Teto de linhas: um relatório não pode virar um despejo do banco inteiro. */
const HISTORICO_MAX_LINHAS = 5_000;

export async function reservationHistoryReport(
  filtros: ReservationHistoryFilters = {},
): Promise<ReportResult> {
  const periodo = resolvePeriodo(filtros.from, filtros.to);
  const limite = Math.min(filtros.limit ?? HISTORICO_MAX_LINHAS, HISTORICO_MAX_LINHAS);

  const where: Prisma.ReservationWhereInput = {
    startsAt: { lt: periodo.fim },
    endsAt: { gt: periodo.inicio },
    ...(filtros.userId ? { userId: filtros.userId } : {}),
    ...(filtros.status?.length ? { status: { in: filtros.status } } : {}),
    ...(filtros.kitId ? { items: { some: { kitId: filtros.kitId } } } : {}),
    ...(filtros.notebookId
      ? { items: { some: { notebookId: filtros.notebookId } } }
      : {}),
    ...(filtros.search
      ? {
          OR: [
            { code: { contains: filtros.search, mode: "insensitive" } },
            { room: { contains: filtros.search, mode: "insensitive" } },
            { purpose: { contains: filtros.search, mode: "insensitive" } },
            { className: { contains: filtros.search, mode: "insensitive" } },
            {
              user: { fullName: { contains: filtros.search, mode: "insensitive" } },
            },
          ],
        }
      : {}),
  };

  const [reservas, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      select: {
        id: true,
        code: true,
        date: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        status: true,
        room: true,
        purpose: true,
        className: true,
        subject: true,
        createdAt: true,
        pickedUpAt: true,
        returnedAt: true,
        closedAt: true,
        cancelReason: true,
        user: { select: { fullName: true, department: true } },
        items: {
          select: {
            kit: { select: { code: true, name: true } },
            notebook: { select: { assetTag: true } },
          },
        },
      },
      orderBy: [{ startsAt: "desc" }],
      take: limite,
    }),
    prisma.reservation.count({ where }),
  ]);

  const linhas = reservas.map((reserva) => ({
    codigo: reserva.code,
    data: formatDateBR(reserva.startsAt),
    periodo: formatIntervalBR(reserva.startsAt, reserva.endsAt, reserva.allDay),
    professor: reserva.user.fullName,
    departamento: reserva.user.department ?? "—",
    situacao: RESERVATION_STATUS_LABEL[reserva.status],
    recursos:
      reserva.items
        .map((item) =>
          item.kit
            ? `${item.kit.name} (${item.kit.code})`
            : (item.notebook?.assetTag ?? "—"),
        )
        .join(", ") || "—",
    turma: reserva.className ?? "—",
    disciplina: reserva.subject ?? "—",
    sala: reserva.room ?? "—",
    finalidade: reserva.purpose ?? "—",
    retiradaEm: reserva.pickedUpAt ? formatDateTimeBR(reserva.pickedUpAt) : "—",
    devolucaoEm: reserva.returnedAt ? formatDateTimeBR(reserva.returnedAt) : "—",
    motivoCancelamento: reserva.cancelReason ?? "—",
  }));

  return {
    tipo: "historico",
    titulo: "Histórico de reservas",
    periodo,
    geradoEm: new Date().toISOString(),
    colunas: [
      { chave: "codigo", rotulo: "Código" },
      { chave: "data", rotulo: "Data", tipo: "data" },
      { chave: "periodo", rotulo: "Período" },
      { chave: "professor", rotulo: "Professor" },
      { chave: "departamento", rotulo: "Departamento/Disciplina" },
      { chave: "situacao", rotulo: "Situação" },
      { chave: "recursos", rotulo: "Recursos" },
      { chave: "turma", rotulo: "Turma" },
      { chave: "disciplina", rotulo: "Disciplina" },
      { chave: "sala", rotulo: "Sala" },
      { chave: "finalidade", rotulo: "Finalidade" },
      { chave: "retiradaEm", rotulo: "Retirada", tipo: "data" },
      { chave: "devolucaoEm", rotulo: "Devolução", tipo: "data" },
      { chave: "motivoCancelamento", rotulo: "Motivo do cancelamento" },
    ],
    linhas,
    resumo: {
      total,
      exibidas: linhas.length,
      truncado: total > linhas.length,
      ...(total > linhas.length
        ? {
            observacao: `Exibindo as ${linhas.length} reservas mais recentes do período. Refine o filtro para ver o restante.`,
          }
        : {}),
    },
    tabelasExtras: [],
  };
}

// ---------------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------------

export type BuildReportOptions = {
  from?: string | null;
  to?: string | null;
  userId?: string;
  kitId?: string;
  notebookId?: string;
  status?: ReservationStatus[];
  search?: string;
};

/** Ponto único de entrada usado pela rota `/api/admin/reports`. */
export async function buildReport(
  tipo: ReportType,
  options: BuildReportOptions = {},
): Promise<ReportResult> {
  switch (tipo) {
    case "utilizacao":
      return utilizationReport(options.from, options.to);
    case "professores":
      return reservationsByTeacher(options.from, options.to);
    case "ocorrencias":
      return incidentsReport(options.from, options.to);
    case "conflitos":
      return conflictsReport(options.from, options.to);
    case "indisponiveis":
      return unavailableResourcesReport();
    case "historico":
      return reservationHistoryReport(options);
  }
}
