import { prisma } from "@/lib/db";
import { audit, auditSafe, diffChanges } from "@/lib/audit";
import { incidentCode, uniqueCode } from "@/lib/codes";
import { dayBounds, formatIntervalBR } from "@/lib/datetime";
import { naoEncontrado, regraDeNegocio, semPermissao } from "@/lib/errors";
import type { SessionUser } from "@/lib/session";
import { buildAttachmentKey, getStorage, validateUpload } from "@/lib/storage";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ChargerKitStatus,
  IncidentCategory,
  IncidentSeverity,
  IncidentStatus,
  IncidentTargetType,
  KitStatus,
  NotebookStatus,
} from "@/generated/prisma/enums";
import { KIT_STATUS_LABEL, NOTEBOOK_STATUS_LABEL } from "./resources";

/**
 * Serviço de ocorrências (incidentes) e seus anexos.
 *
 * Decisões de negócio que este módulo carrega — todas verificadas no servidor,
 * independentemente do que a interface mostre:
 *
 *  1. QUEM PODE ABRIR. O professor pode registrar ocorrência em qualquer
 *     notebook, maleta/carrinho ou kit de carregadores, desde que informe uma
 *     reserva DELE. A alternativa (exigir que o recurso esteja exatamente
 *     naquela reserva) barraria casos reais e frequentes: o carregador que veio
 *     na maleta errada, o notebook que o colega deixou danificado e ele
 *     encontrou ao retirar o kit, o item avulso emprestado no balcão. Amarrar à
 *     reserva do próprio professor preserva o que importa — rastreabilidade de
 *     quem estava com o equipamento — sem transformar o registro de problema em
 *     obstáculo. A supervisão registra ocorrência em qualquer recurso, com ou
 *     sem reserva vinculada.
 *
 *  2. BLOQUEIO DO RECURSO. Severidade ALTA/CRÍTICA em equipamento físico apenas
 *     SUGERE bloqueio; quem decide é quem está registrando. O bloqueio efetivo
 *     (status MANUTENCAO) acontece na mesma transação do registro, para que
 *     nunca exista o intervalo em que a ocorrência já foi gravada e o
 *     equipamento continua reservável.
 *
 *  3. RESOLVER NÃO REATIVA. Fechar a ocorrência não devolve o equipamento à
 *     disponibilidade automaticamente — ver `updateIncident`.
 */

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  ABERTA: "Aberta",
  EM_ANALISE: "Em análise",
  EM_MANUTENCAO: "Em manutenção",
  RESOLVIDA: "Resolvida",
  DESCARTADA: "Descartada",
  RECORRENTE: "Recorrente",
};

export const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
  CRITICA: "Crítica",
};

export const INCIDENT_CATEGORY_LABEL: Record<IncidentCategory, string> = {
  HARDWARE: "Hardware",
  CARREGADOR: "Carregador",
  BATERIA: "Bateria",
  TELA: "Tela",
  TECLADO: "Teclado",
  TOUCHPAD: "Touchpad",
  REDE: "Rede / Wi-Fi",
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

export const INCIDENT_TARGET_LABEL: Record<IncidentTargetType, string> = {
  NOTEBOOK: "Notebook",
  KIT: "Maleta/Carrinho",
  CHARGER_KIT: "Kit de carregadores",
  RESERVATION: "Reserva",
};

/** Rótulos do kit de carregadores (os demais vêm de `./resources`). */
const CHARGER_KIT_STATUS_LABEL: Record<ChargerKitStatus, string> = {
  COMPLETO: "Completo",
  INCOMPLETO: "Incompleto",
  MANUTENCAO: "Em manutenção",
  INDISPONIVEL: "Indisponível",
  DESATIVADO: "Desativado",
};

/** Status finais: a ocorrência não exige mais ação da supervisão. */
export const CLOSED_INCIDENT_STATUSES: IncidentStatus[] = [
  "RESOLVIDA",
  "DESCARTADA",
];

export function incidentIsClosed(status: IncidentStatus): boolean {
  return CLOSED_INCIDENT_STATUSES.includes(status);
}

/** Alvos que representam equipamento físico e, portanto, podem ser bloqueados. */
export const BLOCKABLE_TARGETS: IncidentTargetType[] = [
  "NOTEBOOK",
  "KIT",
  "CHARGER_KIT",
];

/** Severidades que justificam tirar o equipamento de circulação. */
export const BLOCK_SUGGESTING_SEVERITIES: IncidentSeverity[] = [
  "ALTA",
  "CRITICA",
];

/**
 * A regra pedida pela especificação: severidade alta/crítica em equipamento
 * físico sugere bloqueio. É só uma sugestão — a interface avisa, quem registra
 * confirma.
 */
export function shouldSuggestBlock(
  targetType: IncidentTargetType,
  severity: IncidentSeverity,
): boolean {
  return (
    BLOCKABLE_TARGETS.includes(targetType) &&
    BLOCK_SUGGESTING_SEVERITIES.includes(severity)
  );
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type RequestContext = { ip?: string | null; userAgent?: string | null };

export type CreateIncidentInput = {
  targetType: IncidentTargetType;
  notebookId?: string | null;
  kitId?: string | null;
  chargerKitId?: string | null;
  reservationId?: string | null;
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  /** Pedido explícito de tirar o equipamento de circulação. */
  blockResource?: boolean;
};

export type UpdateIncidentInput = {
  category?: IncidentCategory;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  assignedToId?: string | null;
  resolution?: string | null;
  description?: string;
  /** `true` bloqueia o equipamento; `false` devolve à disponibilidade. */
  blockResource?: boolean;
};

export type IncidentFilters = {
  status?: IncidentStatus[];
  severity?: IncidentSeverity[];
  category?: IncidentCategory[];
  targetType?: IncidentTargetType;
  notebookId?: string;
  kitId?: string;
  chargerKitId?: string;
  reservationId?: string;
  assignedToId?: string;
  reportedById?: string;
  /** Recorte por data de abertura, no fuso da instituição. */
  from?: string;
  to?: string;
  busca?: string;
  page?: number;
  pageSize?: number;
};

export type IncidentAttachmentDTO = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Rota autenticada que serve o binário — a chave do storage não é exposta. */
  url: string;
  uploadedBy: { id: string; fullName: string };
};

export type IncidentDTO = {
  id: string;
  code: string;
  targetType: IncidentTargetType;
  targetTypeLabel: string;
  /** Descrição pronta do alvo, para listas e notificações. */
  alvoLabel: string;
  /** `true` se o equipamento está fora de circulação neste momento. */
  recursoBloqueado: boolean;
  category: IncidentCategory;
  categoryLabel: string;
  severity: IncidentSeverity;
  severityLabel: string;
  status: IncidentStatus;
  statusLabel: string;
  encerrada: boolean;
  description: string;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notebook: {
    id: string;
    assetTag: string;
    nickname: string | null;
    status: string;
    statusLabel: string;
  } | null;
  kit: {
    id: string;
    code: string;
    name: string;
    type: string;
    status: string;
    statusLabel: string;
  } | null;
  chargerKit: {
    id: string;
    code: string;
    status: string;
    statusLabel: string;
  } | null;
  reservation: {
    id: string;
    code: string;
    periodoFormatado: string;
    status: string;
    professor: { id: string; fullName: string };
  } | null;
  reportedBy: { id: string; fullName: string; username: string };
  assignedTo: { id: string; fullName: string; username: string } | null;
  attachments: IncidentAttachmentDTO[];
};

export type CreateIncidentResult = {
  ocorrencia: IncidentDTO;
  /** A severidade recomenda tirar o equipamento de circulação. */
  sugerirBloqueio: boolean;
  /** O equipamento ficou (ou já estava) em manutenção. */
  recursoBloqueado: boolean;
  /** Mensagem pronta para exibir ao usuário; `null` quando não há o que avisar. */
  aviso: string | null;
};

export type UpdateIncidentResult = {
  ocorrencia: IncidentDTO;
  recursoBloqueado: boolean;
  /** Esta chamada devolveu o equipamento à disponibilidade. */
  recursoLiberado: boolean;
  aviso: string | null;
};

const incidentInclude = {
  notebook: {
    select: { id: true, assetTag: true, nickname: true, status: true },
  },
  kit: {
    select: { id: true, code: true, name: true, type: true, status: true },
  },
  chargerKit: { select: { id: true, code: true, status: true } },
  reservation: {
    select: {
      id: true,
      code: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      status: true,
      userId: true,
      user: { select: { id: true, fullName: true } },
    },
  },
  reportedBy: { select: { id: true, fullName: true, username: true } },
  assignedTo: { select: { id: true, fullName: true, username: true } },
  attachments: {
    include: { uploadedBy: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.IncidentInclude;

type IncidentWithRelations = Prisma.IncidentGetPayload<{
  include: typeof incidentInclude;
}>;

type AttachmentWithUploader = IncidentWithRelations["attachments"][number];

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

function toAttachmentDTO(row: AttachmentWithUploader): IncidentAttachmentDTO {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    url: `/api/attachments/${row.id}`,
    uploadedBy: {
      id: row.uploadedBy.id,
      fullName: row.uploadedBy.fullName,
    },
  };
}

/** Nome curto do notebook, com apelido quando existir. */
function notebookLabel(notebook: { assetTag: string; nickname: string | null }): string {
  return `Notebook ${notebook.assetTag}${notebook.nickname ? ` — ${notebook.nickname}` : ""}`;
}

function describeTarget(incident: IncidentWithRelations): string {
  switch (incident.targetType) {
    case "NOTEBOOK":
      return incident.notebook ? notebookLabel(incident.notebook) : "Notebook removido";
    case "KIT":
      return incident.kit
        ? `${incident.kit.name} (${incident.kit.code})`
        : "Kit removido";
    case "CHARGER_KIT":
      return incident.chargerKit
        ? `Kit de carregadores ${incident.chargerKit.code}`
        : "Kit de carregadores removido";
    case "RESERVATION":
      return incident.reservation
        ? `Reserva ${incident.reservation.code}`
        : "Reserva removida";
  }
}

/** O equipamento alvo está fora de circulação neste momento? */
function targetIsBlocked(incident: IncidentWithRelations): boolean {
  if (incident.targetType === "NOTEBOOK") {
    return incident.notebook?.status === "MANUTENCAO";
  }
  if (incident.targetType === "KIT") {
    return incident.kit?.status === "MANUTENCAO";
  }
  if (incident.targetType === "CHARGER_KIT") {
    return incident.chargerKit?.status === "MANUTENCAO";
  }
  return false;
}

function toIncidentDTO(incident: IncidentWithRelations): IncidentDTO {
  return {
    id: incident.id,
    code: incident.code,
    targetType: incident.targetType,
    targetTypeLabel: INCIDENT_TARGET_LABEL[incident.targetType],
    alvoLabel: describeTarget(incident),
    recursoBloqueado: targetIsBlocked(incident),
    category: incident.category,
    categoryLabel: INCIDENT_CATEGORY_LABEL[incident.category],
    severity: incident.severity,
    severityLabel: INCIDENT_SEVERITY_LABEL[incident.severity],
    status: incident.status,
    statusLabel: INCIDENT_STATUS_LABEL[incident.status],
    encerrada: incidentIsClosed(incident.status),
    description: incident.description,
    resolution: incident.resolution,
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    notebook: incident.notebook
      ? {
          id: incident.notebook.id,
          assetTag: incident.notebook.assetTag,
          nickname: incident.notebook.nickname,
          status: incident.notebook.status,
          statusLabel: NOTEBOOK_STATUS_LABEL[incident.notebook.status],
        }
      : null,
    kit: incident.kit
      ? {
          id: incident.kit.id,
          code: incident.kit.code,
          name: incident.kit.name,
          type: incident.kit.type,
          status: incident.kit.status,
          statusLabel: KIT_STATUS_LABEL[incident.kit.status],
        }
      : null,
    chargerKit: incident.chargerKit
      ? {
          id: incident.chargerKit.id,
          code: incident.chargerKit.code,
          status: incident.chargerKit.status,
          statusLabel: CHARGER_KIT_STATUS_LABEL[incident.chargerKit.status],
        }
      : null,
    // Do vínculo com a reserva sai só o essencial: nome do docente e período.
    // Telefone e e-mail de terceiros nunca saem daqui.
    reservation: incident.reservation
      ? {
          id: incident.reservation.id,
          code: incident.reservation.code,
          periodoFormatado: formatIntervalBR(
            incident.reservation.startsAt,
            incident.reservation.endsAt,
            incident.reservation.allDay,
          ),
          status: incident.reservation.status,
          professor: {
            id: incident.reservation.user.id,
            fullName: incident.reservation.user.fullName,
          },
        }
      : null,
    // Campo a campo, e não a linha crua do banco: se um dia o `select` de
    // `incidentInclude` ganhar e-mail ou telefone, eles não vazam sozinhos na
    // resposta sem ninguém ter decidido por isso.
    reportedBy: {
      id: incident.reportedBy.id,
      fullName: incident.reportedBy.fullName,
      username: incident.reportedBy.username,
    },
    assignedTo: incident.assignedTo
      ? {
          id: incident.assignedTo.id,
          fullName: incident.assignedTo.fullName,
          username: incident.assignedTo.username,
        }
      : null,
    attachments: incident.attachments.map(toAttachmentDTO),
  };
}

// ---------------------------------------------------------------------------
// Visibilidade
// ---------------------------------------------------------------------------

type VisibilityShape = {
  reportedById: string;
  reservation: { userId: string } | null;
};

/**
 * O professor enxerga o que registrou e o que está preso a uma reserva dele —
 * um problema aberto pela supervisão no equipamento que ele usou é assunto
 * dele. Fora isso, respondemos "não encontrada": confirmar a existência de uma
 * ocorrência alheia já seria vazamento.
 */
function canSeeIncident(incident: VisibilityShape, actor: SessionUser): boolean {
  if (actor.role === "SUPERVISOR") return true;
  if (incident.reportedById === actor.id) return true;
  return incident.reservation?.userId === actor.id;
}

// ---------------------------------------------------------------------------
// Resolução e validação do alvo
// ---------------------------------------------------------------------------

type TargetSnapshot = {
  notebook: {
    id: string;
    assetTag: string;
    nickname: string | null;
    status: NotebookStatus;
  } | null;
  kit: { id: string; code: string; name: string; status: KitStatus } | null;
  chargerKit: { id: string; code: string; status: ChargerKitStatus } | null;
  reservation: { id: string; code: string; userId: string } | null;
  label: string;
};

/**
 * Confere que tudo o que foi informado existe de verdade.
 *
 * Validamos todas as FKs enviadas, não apenas a do `targetType`: uma ocorrência
 * de notebook pode (e deve) apontar também a reserva em que o problema
 * apareceu, e um id inválido ali estragaria o histórico silenciosamente.
 */
async function resolveTarget(
  client: Prisma.TransactionClient,
  input: CreateIncidentInput,
): Promise<TargetSnapshot> {
  const [notebook, kit, chargerKit, reservation] = await Promise.all([
    input.notebookId
      ? client.notebook.findUnique({
          where: { id: input.notebookId },
          select: { id: true, assetTag: true, nickname: true, status: true },
        })
      : Promise.resolve(null),
    input.kitId
      ? client.kit.findUnique({
          where: { id: input.kitId },
          select: { id: true, code: true, name: true, status: true },
        })
      : Promise.resolve(null),
    input.chargerKitId
      ? client.chargerKit.findUnique({
          where: { id: input.chargerKitId },
          select: { id: true, code: true, status: true },
        })
      : Promise.resolve(null),
    input.reservationId
      ? client.reservation.findUnique({
          where: { id: input.reservationId },
          select: { id: true, code: true, userId: true },
        })
      : Promise.resolve(null),
  ]);

  if (input.notebookId && !notebook) {
    throw naoEncontrado("O notebook informado não existe mais.");
  }
  if (input.kitId && !kit) {
    throw naoEncontrado("A maleta/carrinho informada não existe mais.");
  }
  if (input.chargerKitId && !chargerKit) {
    throw naoEncontrado("O kit de carregadores informado não existe mais.");
  }
  if (input.reservationId && !reservation) {
    throw naoEncontrado("A reserva informada não existe mais.");
  }

  // O alvo declarado precisa estar presente. O esquema Zod já cobre isso na
  // borda HTTP; repetimos aqui porque o serviço também é chamado de dentro do
  // encerramento de reserva, sem passar por rota.
  let label: string;
  switch (input.targetType) {
    case "NOTEBOOK":
      if (!notebook) throw regraDeNegocio("Selecione o notebook da ocorrência.");
      label = notebookLabel(notebook);
      break;
    case "KIT":
      if (!kit) throw regraDeNegocio("Selecione a maleta/carrinho da ocorrência.");
      label = `${kit.name} (${kit.code})`;
      break;
    case "CHARGER_KIT":
      if (!chargerKit) {
        throw regraDeNegocio("Selecione o kit de carregadores da ocorrência.");
      }
      label = `Kit de carregadores ${chargerKit.code}`;
      break;
    case "RESERVATION":
      if (!reservation) throw regraDeNegocio("Selecione a reserva da ocorrência.");
      label = `Reserva ${reservation.code}`;
      break;
  }

  return { notebook, kit, chargerKit, reservation, label };
}

/** Aplica a regra 1 do cabeçalho deste módulo. */
function assertCanReport(
  input: CreateIncidentInput,
  target: TargetSnapshot,
  actor: SessionUser,
): void {
  if (actor.role === "SUPERVISOR") return;

  if (input.targetType === "RESERVATION") {
    if (target.reservation?.userId !== actor.id) {
      throw semPermissao(
        "Você só pode registrar ocorrências nas suas próprias reservas.",
      );
    }
    return;
  }

  if (!target.reservation) {
    throw regraDeNegocio(
      "Informe a reserva em que você utilizou o equipamento. " +
        "Se o problema não está ligado a uma reserva sua, procure a supervisão.",
    );
  }
  if (target.reservation.userId !== actor.id) {
    throw semPermissao(
      "A reserva informada não é sua. Selecione uma reserva em que você utilizou o equipamento.",
    );
  }
}

// ---------------------------------------------------------------------------
// Bloqueio e liberação do equipamento
// ---------------------------------------------------------------------------

type BlockOutcome = {
  /** Estado do equipamento depois da operação. */
  bloqueado: boolean;
  /** A operação de fato mudou o status. */
  alterado: boolean;
  aviso: string | null;
};

/**
 * Marca o equipamento como MANUTENCAO.
 *
 * Não sobrescreve estados que significam outra coisa (desativado, perdido):
 * "em manutenção" seria uma informação menos verdadeira do que a atual. Também
 * não propaga para os notebooks de dentro de um kit — o kit é a unidade
 * reservável, e mexer em cada notebook criaria um efeito colateral difícil de
 * desfazer depois.
 */
async function blockTarget(
  client: Prisma.TransactionClient,
  targetType: IncidentTargetType,
  target: TargetSnapshot,
  actor: SessionUser,
  ctx: RequestContext,
  motivo: string,
): Promise<BlockOutcome> {
  if (targetType === "NOTEBOOK" && target.notebook) {
    const { id, status } = target.notebook;
    if (status === "MANUTENCAO") {
      return { bloqueado: true, alterado: false, aviso: null };
    }
    if (status === "DESATIVADO" || status === "PERDIDO") {
      return {
        bloqueado: false,
        alterado: false,
        aviso: `O notebook ${target.notebook.assetTag} está "${NOTEBOOK_STATUS_LABEL[status]}" e o status foi mantido.`,
      };
    }
    await client.notebook.update({ where: { id }, data: { status: "MANUTENCAO" } });
    await audit(
      {
        actorId: actor.id,
        action: "notebook.bloquear",
        entity: "Notebook",
        entityId: id,
        summary: `Notebook ${target.notebook.assetTag} enviado para manutenção — ${motivo}`,
        before: { status },
        after: { status: "MANUTENCAO" },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      client,
    );
    return {
      bloqueado: true,
      alterado: true,
      aviso: `O notebook ${target.notebook.assetTag} foi marcado como "Em manutenção" e não pode mais ser reservado até a supervisão liberá-lo.`,
    };
  }

  if (targetType === "KIT" && target.kit) {
    const { id, status } = target.kit;
    if (status === "MANUTENCAO") {
      return { bloqueado: true, alterado: false, aviso: null };
    }
    if (status === "DESATIVADO") {
      return {
        bloqueado: false,
        alterado: false,
        aviso: `"${target.kit.name}" está desativado e o status foi mantido.`,
      };
    }
    await client.kit.update({ where: { id }, data: { status: "MANUTENCAO" } });
    await audit(
      {
        actorId: actor.id,
        action: "kit.bloquear",
        entity: "Kit",
        entityId: id,
        summary: `${target.kit.name} enviado para manutenção — ${motivo}`,
        before: { status },
        after: { status: "MANUTENCAO" },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      client,
    );
    return {
      bloqueado: true,
      alterado: true,
      aviso: `"${target.kit.name}" foi marcado como "Em manutenção" e não pode mais ser reservado até a supervisão liberá-lo.`,
    };
  }

  if (targetType === "CHARGER_KIT" && target.chargerKit) {
    const { id, status } = target.chargerKit;
    if (status === "MANUTENCAO") {
      return { bloqueado: true, alterado: false, aviso: null };
    }
    if (status === "DESATIVADO") {
      return {
        bloqueado: false,
        alterado: false,
        aviso: `O kit de carregadores ${target.chargerKit.code} está desativado e o status foi mantido.`,
      };
    }
    await client.chargerKit.update({
      where: { id },
      data: { status: "MANUTENCAO" },
    });
    await audit(
      {
        actorId: actor.id,
        action: "kitCarregadores.bloquear",
        entity: "ChargerKit",
        entityId: id,
        summary: `Kit de carregadores ${target.chargerKit.code} enviado para manutenção — ${motivo}`,
        before: { status },
        after: { status: "MANUTENCAO" },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      client,
    );
    return {
      bloqueado: true,
      alterado: true,
      aviso: `O kit de carregadores ${target.chargerKit.code} foi marcado como "Em manutenção".`,
    };
  }

  return {
    bloqueado: false,
    alterado: false,
    aviso: "Este tipo de ocorrência não bloqueia equipamento.",
  };
}

/**
 * Devolve o equipamento à disponibilidade.
 *
 * Só age sobre o que este sistema tirou de circulação (`MANUTENCAO`): um item
 * marcado como perdido, indisponível ou desativado tem outro motivo por trás, e
 * "liberar" seria apagar uma decisão que não é desta ocorrência.
 */
async function unblockTarget(
  client: Prisma.TransactionClient,
  incident: IncidentWithRelations,
  actor: SessionUser,
  ctx: RequestContext,
): Promise<BlockOutcome> {
  const motivo = `liberado ao tratar a ocorrência ${incident.code}`;

  if (incident.targetType === "NOTEBOOK" && incident.notebook) {
    if (incident.notebook.status !== "MANUTENCAO") {
      return { bloqueado: false, alterado: false, aviso: null };
    }
    await client.notebook.update({
      where: { id: incident.notebook.id },
      data: { status: "DISPONIVEL" },
    });
    await audit(
      {
        actorId: actor.id,
        action: "notebook.liberar",
        entity: "Notebook",
        entityId: incident.notebook.id,
        summary: `Notebook ${incident.notebook.assetTag} ${motivo}`,
        before: { status: "MANUTENCAO" },
        after: { status: "DISPONIVEL" },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      client,
    );
    return {
      bloqueado: false,
      alterado: true,
      aviso: `O notebook ${incident.notebook.assetTag} voltou a ficar disponível para reserva.`,
    };
  }

  if (incident.targetType === "KIT" && incident.kit) {
    if (incident.kit.status !== "MANUTENCAO") {
      return { bloqueado: false, alterado: false, aviso: null };
    }
    await client.kit.update({
      where: { id: incident.kit.id },
      data: { status: "DISPONIVEL" },
    });
    await audit(
      {
        actorId: actor.id,
        action: "kit.liberar",
        entity: "Kit",
        entityId: incident.kit.id,
        summary: `${incident.kit.name} ${motivo}`,
        before: { status: "MANUTENCAO" },
        after: { status: "DISPONIVEL" },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      client,
    );
    return {
      bloqueado: false,
      alterado: true,
      aviso: `"${incident.kit.name}" voltou a ficar disponível para reserva.`,
    };
  }

  if (incident.targetType === "CHARGER_KIT" && incident.chargerKit) {
    if (incident.chargerKit.status !== "MANUTENCAO") {
      return { bloqueado: false, alterado: false, aviso: null };
    }
    // A contagem de carregadores é quem decide o status de volta: um kit que
    // voltou da manutenção ainda incompleto não pode ser dado como completo.
    const atual = await client.chargerKit.findUnique({
      where: { id: incident.chargerKit.id },
      select: { totalQuantity: true, availableQuantity: true },
    });
    const proximoStatus: ChargerKitStatus =
      atual && atual.availableQuantity >= atual.totalQuantity
        ? "COMPLETO"
        : "INCOMPLETO";

    await client.chargerKit.update({
      where: { id: incident.chargerKit.id },
      data: { status: proximoStatus },
    });
    await audit(
      {
        actorId: actor.id,
        action: "kitCarregadores.liberar",
        entity: "ChargerKit",
        entityId: incident.chargerKit.id,
        summary: `Kit de carregadores ${incident.chargerKit.code} ${motivo}`,
        before: { status: "MANUTENCAO" },
        after: { status: proximoStatus },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      client,
    );
    return {
      bloqueado: false,
      alterado: true,
      aviso: `O kit de carregadores ${incident.chargerKit.code} voltou como "${CHARGER_KIT_STATUS_LABEL[proximoStatus]}".`,
    };
  }

  return { bloqueado: false, alterado: false, aviso: null };
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

/**
 * Registra uma ocorrência.
 *
 * `client` permite executar dentro de uma transação já aberta — é assim que o
 * encerramento de reserva grava a devolução e a ocorrência de forma atômica.
 * Sem ele, abrimos a transação aqui: o registro, o eventual bloqueio do
 * equipamento e as duas auditorias precisam cair juntos ou não cair.
 */
export async function createIncident(
  input: CreateIncidentInput,
  actor: SessionUser,
  ctx: RequestContext = {},
  client?: Prisma.TransactionClient,
): Promise<CreateIncidentResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<CreateIncidentResult> => {
    const target = await resolveTarget(tx, input);
    assertCanReport(input, target, actor);

    const sugerirBloqueio = shouldSuggestBlock(input.targetType, input.severity);

    // O professor pode tirar de circulação o que ele mesmo constatou quebrado —
    // deixar o próximo colega levar um equipamento danificado é pior do que uma
    // indisponibilidade a mais para a supervisão revisar. Em severidade baixa,
    // porém, a decisão é da supervisão.
    if (input.blockResource && actor.role !== "SUPERVISOR" && !sugerirBloqueio) {
      // Duas causas diferentes levam a `sugerirBloqueio === false`. Dizer
      // "severidade" para quem escolheu "Crítica" em uma ocorrência de reserva
      // manda o professor tentar de novo do jeito errado.
      throw regraDeNegocio(
        BLOCKABLE_TARGETS.includes(input.targetType)
          ? "Só é possível bloquear o equipamento em ocorrências de severidade alta ou crítica. " +
              "Registre a ocorrência e a supervisão avaliará o bloqueio."
          : "Ocorrência de reserva não bloqueia equipamento. Se o problema é em um notebook, " +
              "maleta/carrinho ou kit de carregadores, registre a ocorrência no próprio equipamento.",
      );
    }

    const code = await uniqueCode(incidentCode, async (candidate) =>
      Boolean(await tx.incident.findUnique({ where: { code: candidate } })),
    );

    const created = await tx.incident.create({
      data: {
        code,
        targetType: input.targetType,
        notebookId: target.notebook?.id ?? null,
        kitId: target.kit?.id ?? null,
        chargerKitId: target.chargerKit?.id ?? null,
        reservationId: target.reservation?.id ?? null,
        reportedById: actor.id,
        category: input.category,
        severity: input.severity,
        status: "ABERTA",
        description: input.description,
      },
      include: incidentInclude,
    });

    let bloqueio: BlockOutcome = { bloqueado: false, alterado: false, aviso: null };
    if (input.blockResource) {
      bloqueio = await blockTarget(
        tx,
        input.targetType,
        target,
        actor,
        ctx,
        `ocorrência ${code}`,
      );
    }

    await audit(
      {
        actorId: actor.id,
        action: "ocorrencia.registrar",
        entity: "Incident",
        entityId: created.id,
        summary:
          `Ocorrência ${code} (${INCIDENT_SEVERITY_LABEL[input.severity].toLowerCase()}) ` +
          `em ${target.label}: ${INCIDENT_CATEGORY_LABEL[input.category]}`,
        after: {
          code,
          targetType: input.targetType,
          alvo: target.label,
          category: input.category,
          severity: input.severity,
          status: "ABERTA",
          reservationId: target.reservation?.id ?? null,
          recursoBloqueado: bloqueio.bloqueado,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      tx,
    );

    // O DTO precisa refletir o bloqueio recém-aplicado; o registro carregado no
    // `create` foi lido antes do update de status do equipamento.
    const fresh = bloqueio.alterado
      ? ((await tx.incident.findUnique({
          where: { id: created.id },
          include: incidentInclude,
        })) ?? created)
      : created;

    const aviso =
      bloqueio.aviso ??
      (sugerirBloqueio && !bloqueio.bloqueado
        ? `Severidade ${INCIDENT_SEVERITY_LABEL[input.severity].toLowerCase()}: avalie bloquear ${target.label} para manutenção.`
        : null);

    return {
      ocorrencia: toIncidentDTO(fresh),
      sugerirBloqueio,
      recursoBloqueado: bloqueio.bloqueado,
      aviso,
    };
  };

  return client ? run(client) : prisma.$transaction(run);
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export async function listIncidents(
  filters: IncidentFilters,
  actor: SessionUser,
): Promise<{
  items: IncidentDTO[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  const periodo =
    filters.from || filters.to
      ? {
          ...(filters.from ? { gte: dayBounds(filters.from).start } : {}),
          ...(filters.to ? { lt: dayBounds(filters.to).end } : {}),
        }
      : undefined;

  const busca = filters.busca?.trim();

  const where: Prisma.IncidentWhereInput = {
    // O recorte por perfil vem primeiro e é inegociável: um professor que
    // chame a API direto continua vendo apenas o que lhe diz respeito.
    ...(actor.role === "SUPERVISOR"
      ? {}
      : {
          OR: [
            { reportedById: actor.id },
            { reservation: { userId: actor.id } },
          ],
        }),
    ...(filters.status?.length ? { status: { in: filters.status } } : {}),
    ...(filters.severity?.length ? { severity: { in: filters.severity } } : {}),
    ...(filters.category?.length ? { category: { in: filters.category } } : {}),
    ...(filters.targetType ? { targetType: filters.targetType } : {}),
    ...(filters.notebookId ? { notebookId: filters.notebookId } : {}),
    ...(filters.kitId ? { kitId: filters.kitId } : {}),
    ...(filters.chargerKitId ? { chargerKitId: filters.chargerKitId } : {}),
    ...(filters.reservationId ? { reservationId: filters.reservationId } : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.reportedById ? { reportedById: filters.reportedById } : {}),
    ...(periodo ? { createdAt: periodo } : {}),
    // A busca textual entra como AND para não anular o recorte por perfil
    // acima, que já ocupa o `OR` de primeiro nível.
    ...(busca
      ? {
          AND: [
            {
              OR: [
                { code: { contains: busca, mode: "insensitive" } },
                { description: { contains: busca, mode: "insensitive" } },
                { resolution: { contains: busca, mode: "insensitive" } },
                { notebook: { assetTag: { contains: busca, mode: "insensitive" } } },
                { kit: { name: { contains: busca, mode: "insensitive" } } },
                { kit: { code: { contains: busca, mode: "insensitive" } } },
                { reservation: { code: { contains: busca, mode: "insensitive" } } },
              ],
            },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.incident.findMany({
      where,
      include: incidentInclude,
      // Mais recentes primeiro: é a ordem que a supervisão espera ao abrir a
      // tela. A triagem por gravidade se faz pelo filtro de severidade.
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.incident.count({ where }),
  ]);

  return { items: items.map(toIncidentDTO), total, page, pageSize };
}

async function loadIncidentOrThrow(
  id: string,
  actor: SessionUser,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<IncidentWithRelations> {
  const incident = await client.incident.findUnique({
    where: { id },
    include: incidentInclude,
  });
  if (!incident) throw naoEncontrado("Ocorrência não encontrada.");
  if (
    !canSeeIncident(
      {
        reportedById: incident.reportedById,
        reservation: incident.reservation
          ? { userId: incident.reservation.userId }
          : null,
      },
      actor,
    )
  ) {
    throw naoEncontrado("Ocorrência não encontrada.");
  }
  return incident;
}

export async function getIncident(
  id: string,
  actor: SessionUser,
): Promise<IncidentDTO> {
  return toIncidentDTO(await loadIncidentOrThrow(id, actor));
}

/**
 * Confere só a permissão de leitura, sem montar o DTO.
 *
 * Para quem precisa apenas do "pode ver?" — o histórico, por exemplo — carregar
 * notebook, maleta, kit, reserva, anexos e quem os enviou para jogar tudo fora
 * em seguida é uma dezena de consultas sem destino. A resposta continua sendo a
 * mesma de um id inexistente.
 */
export async function assertCanSeeIncident(
  id: string,
  actor: SessionUser,
): Promise<void> {
  const incident = await prisma.incident.findUnique({
    where: { id },
    select: {
      reportedById: true,
      reservation: { select: { userId: true } },
    },
  });
  if (!incident || !canSeeIncident(incident, actor)) {
    throw naoEncontrado("Ocorrência não encontrada.");
  }
}

// ---------------------------------------------------------------------------
// Alteração
// ---------------------------------------------------------------------------

/**
 * Atualiza uma ocorrência.
 *
 * Só a supervisão muda status, atribui responsável, reclassifica e registra a
 * solução. O professor que abriu pode complementar a descrição enquanto a
 * ocorrência estiver em aberto — é comum lembrar de um detalhe depois de
 * enviar, e obrigá-lo a abrir uma segunda ocorrência só polui o histórico.
 *
 * DECISÃO: resolver a ocorrência NÃO devolve o equipamento à disponibilidade.
 * "Problema documentado como resolvido" e "equipamento conferido e pronto para
 * a próxima aula" são eventos diferentes, e confundi-los colocaria de volta em
 * circulação um notebook que ninguém testou. A resposta informa que o recurso
 * segue bloqueado; a supervisão libera quando quiser, aqui mesmo
 * (`blockResource: false`) ou pelo cadastro do equipamento.
 */
export async function updateIncident(
  id: string,
  patch: UpdateIncidentInput,
  actor: SessionUser,
  ctx: RequestContext = {},
): Promise<UpdateIncidentResult> {
  const isSupervisor = actor.role === "SUPERVISOR";

  const existing = await loadIncidentOrThrow(id, actor);

  const camposDeSupervisao = (
    ["category", "severity", "status", "assignedToId", "resolution", "blockResource"] as const
  ).filter((campo) => patch[campo] !== undefined);

  if (!isSupervisor) {
    if (camposDeSupervisao.length > 0) {
      throw semPermissao(
        "Somente a supervisão pode alterar status, responsável, classificação ou solução " +
          "da ocorrência, e bloquear ou liberar o equipamento. Você pode complementar a descrição.",
      );
    }
    if (existing.reportedById !== actor.id) {
      throw semPermissao("Você só pode complementar ocorrências que registrou.");
    }
    if (incidentIsClosed(existing.status)) {
      throw regraDeNegocio(
        `Esta ocorrência já está "${INCIDENT_STATUS_LABEL[existing.status]}" e não pode mais ser alterada.`,
      );
    }
  }

  const proximoStatus = patch.status ?? existing.status;
  const vaiEncerrar = incidentIsClosed(proximoStatus);
  const resolucaoFinal =
    patch.resolution !== undefined ? patch.resolution : existing.resolution;

  // Encerrar sem dizer o que foi feito transforma o histórico em ruído: seis
  // meses depois ninguém sabe se o notebook foi consertado ou descartado.
  if (vaiEncerrar && !incidentIsClosed(existing.status) && !resolucaoFinal?.trim()) {
    throw regraDeNegocio(
      proximoStatus === "RESOLVIDA"
        ? "Descreva a solução aplicada antes de marcar a ocorrência como resolvida."
        : "Justifique o descarte da ocorrência no campo de solução.",
    );
  }

  if (patch.assignedToId) {
    const responsavel = await prisma.user.findUnique({
      where: { id: patch.assignedToId },
      select: { id: true, role: true, active: true, fullName: true },
    });
    if (!responsavel) throw naoEncontrado("Responsável não encontrado.");
    if (!responsavel.active) {
      throw regraDeNegocio(
        "Não é possível atribuir a ocorrência a uma conta desativada.",
      );
    }
    // O acompanhamento da manutenção é atribuição da supervisão; um professor
    // como responsável não teria nem permissão para fechar a ocorrência.
    if (responsavel.role !== "SUPERVISOR") {
      throw regraDeNegocio(
        "A ocorrência só pode ser atribuída a um usuário da supervisão.",
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const data: Prisma.IncidentUpdateInput = {
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.resolution !== undefined ? { resolution: patch.resolution } : {}),
      ...(patch.assignedToId !== undefined
        ? {
            assignedTo: patch.assignedToId
              ? { connect: { id: patch.assignedToId } }
              : { disconnect: true },
          }
        : {}),
      // `resolvedAt` é derivado do status, nunca informado pelo cliente:
      // marca quando encerrou e limpa se a ocorrência for reaberta.
      ...(patch.status !== undefined
        ? vaiEncerrar
          ? { resolvedAt: existing.resolvedAt ?? new Date() }
          : { resolvedAt: null }
        : {}),
    };

    const updated = await tx.incident.update({
      where: { id },
      data,
      include: incidentInclude,
    });

    let bloqueio: BlockOutcome = {
      bloqueado: targetIsBlocked(updated),
      alterado: false,
      aviso: null,
    };

    if (patch.blockResource === true) {
      bloqueio = await blockTarget(
        tx,
        updated.targetType,
        {
          notebook: updated.notebook,
          kit: updated.kit,
          chargerKit: updated.chargerKit,
          reservation: updated.reservation
            ? {
                id: updated.reservation.id,
                code: updated.reservation.code,
                userId: updated.reservation.userId,
              }
            : null,
          label: describeTarget(updated),
        },
        actor,
        ctx,
        `ocorrência ${updated.code}`,
      );
    } else if (patch.blockResource === false) {
      bloqueio = await unblockTarget(tx, updated, actor, ctx);
    }

    const mudancas = diffChanges(
      {
        status: existing.status,
        severity: existing.severity,
        category: existing.category,
        assignedToId: existing.assignedToId,
        resolution: existing.resolution,
        description: existing.description,
      },
      {
        status: updated.status,
        severity: updated.severity,
        category: updated.category,
        assignedToId: updated.assignedToId,
        resolution: updated.resolution,
        description: updated.description,
      },
    );

    await audit(
      {
        actorId: actor.id,
        action: "ocorrencia.atualizar",
        entity: "Incident",
        entityId: id,
        summary:
          patch.status && patch.status !== existing.status
            ? `Ocorrência ${updated.code}: ${INCIDENT_STATUS_LABEL[existing.status]} → ${INCIDENT_STATUS_LABEL[patch.status]}`
            : mudancas.changedKeys.length > 0
              ? `Ocorrência ${updated.code} — alterado: ${mudancas.changedKeys.join(", ")}`
              : `Ocorrência ${updated.code} atualizada`,
        before: mudancas.before,
        after: {
          ...mudancas.after,
          ...(patch.blockResource !== undefined
            ? { recursoBloqueado: bloqueio.bloqueado }
            : {}),
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      tx,
    );

    const fresh = bloqueio.alterado
      ? ((await tx.incident.findUnique({ where: { id }, include: incidentInclude })) ??
        updated)
      : updated;

    // Encerrou a ocorrência mas o equipamento continua fora de circulação:
    // avisamos em vez de reativar sozinhos.
    const avisoBloqueioPersistente =
      vaiEncerrar && bloqueio.bloqueado && patch.blockResource !== true
        ? `${describeTarget(fresh)} continua em manutenção. Libere o equipamento quando ele estiver conferido e pronto para uso.`
        : null;

    return {
      ocorrencia: toIncidentDTO(fresh),
      recursoBloqueado: bloqueio.bloqueado,
      recursoLiberado: patch.blockResource === false && bloqueio.alterado,
      aviso: bloqueio.aviso ?? avisoBloqueioPersistente,
    };
  });
}

// ---------------------------------------------------------------------------
// Anexos
// ---------------------------------------------------------------------------

/** Fotos são a prova do estado do equipamento; cinco cobrem qualquer caso real. */
export const MAX_ATTACHMENTS_PER_INCIDENT = 5;

export type UploadFile = {
  fileName: string;
  /** Tipo declarado pelo cliente — conferido contra os bytes em `validateUpload`. */
  mimeType: string;
  bytes: Buffer;
};

export async function addAttachment(
  incidentId: string,
  file: UploadFile,
  actor: SessionUser,
  ctx: RequestContext = {},
): Promise<IncidentAttachmentDTO> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      code: true,
      status: true,
      reportedById: true,
      reservation: { select: { userId: true } },
      _count: { select: { attachments: true } },
    },
  });
  if (!incident) throw naoEncontrado("Ocorrência não encontrada.");
  if (!canSeeIncident(incident, actor)) {
    throw naoEncontrado("Ocorrência não encontrada.");
  }

  // A supervisão ainda anexa laudos depois do fechamento; para o professor, a
  // ocorrência encerrada é um documento fechado.
  if (actor.role !== "SUPERVISOR" && incidentIsClosed(incident.status)) {
    throw regraDeNegocio(
      `Esta ocorrência já está "${INCIDENT_STATUS_LABEL[incident.status]}" e não aceita novos anexos.`,
    );
  }

  // Não existe rota de remoção de anexo: mandar "remova um anexo antes de
  // enviar outro" deixaria o professor procurando um botão que não existe.
  if (incident._count.attachments >= MAX_ATTACHMENTS_PER_INCIDENT) {
    throw regraDeNegocio(
      `Cada ocorrência aceita no máximo ${MAX_ATTACHMENTS_PER_INCIDENT} anexos, e esta já chegou ao limite. ` +
        "Descreva o que falta no texto da ocorrência ou registre uma nova para as demais fotos.",
    );
  }

  // Valida assinatura, tamanho e tipo ANTES de tocar no storage.
  const { mimeType, extension, safeName } = validateUpload(
    file.fileName,
    file.mimeType,
    file.bytes,
  );

  const storageKey = buildAttachmentKey(incident.id, extension);
  const storage = getStorage();
  const stored = await storage.put(storageKey, file.bytes, mimeType);

  let created;
  try {
    created = await prisma.incidentAttachment.create({
      data: {
        incidentId: incident.id,
        storageKey,
        fileName: safeName,
        mimeType,
        sizeBytes: stored.size,
        uploadedById: actor.id,
      },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    });
  } catch (error) {
    // O binário já subiu; sem a linha no banco ele seria lixo permanente.
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }

  await auditSafe({
    actorId: actor.id,
    action: "ocorrencia.anexar",
    entity: "Incident",
    entityId: incident.id,
    summary: `Anexo "${safeName}" adicionado à ocorrência ${incident.code}`,
    after: {
      attachmentId: created.id,
      fileName: safeName,
      mimeType,
      sizeBytes: stored.size,
    },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return toAttachmentDTO(created);
}

export type AttachmentContent = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  body: Buffer;
};

/**
 * Devolve o binário de um anexo.
 *
 * A permissão é conferida com os metadados, ANTES de buscar o conteúdo no
 * storage: quem não pode ver o anexo não gera nem tráfego de leitura, e a
 * resposta é a mesma de um id inexistente.
 */
export async function getAttachment(
  id: string,
  actor: SessionUser,
): Promise<AttachmentContent> {
  const attachment = await prisma.incidentAttachment.findUnique({
    where: { id },
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      incident: {
        select: {
          reportedById: true,
          reservation: { select: { userId: true } },
        },
      },
    },
  });
  if (!attachment) throw naoEncontrado("Anexo não encontrado.");
  if (!canSeeIncident(attachment.incident, actor)) {
    throw naoEncontrado("Anexo não encontrado.");
  }

  const object = await getStorage().get(attachment.storageKey);
  if (!object) {
    throw naoEncontrado(
      "O arquivo não está mais disponível no armazenamento. Peça um novo envio.",
    );
  }

  return {
    id: attachment.id,
    fileName: attachment.fileName,
    // O tipo gravado no banco é o detectado pelos bytes no upload; é mais
    // confiável do que o que o storage devolve.
    mimeType: attachment.mimeType,
    sizeBytes: object.body.length,
    body: object.body,
  };
}
