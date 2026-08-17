import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { formatIntervalBR } from "@/lib/datetime";
import { prisma } from "@/lib/db";
import { handle, json, readQuery } from "@/lib/http";
import type { SessionUser } from "@/lib/session";
import { RESERVATION_STATUS_LABEL } from "@/server/reservation-policy";
import {
  KIT_STATUS_LABEL,
  NOTEBOOK_STATUS_LABEL,
  kitKey,
  notebookKey,
} from "@/server/resources";
import {
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
} from "@/server/reports";

export const dynamic = "force-dynamic";

/** Teto por grupo: a busca global é um atalho, não uma listagem. */
const MAX_POR_GRUPO = 10;

const searchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, "Digite ao menos 2 caracteres para buscar.")
    .max(80, "Termo de busca muito longo."),
});

export type ResultadoBusca = {
  id: string;
  titulo: string;
  subtitulo: string;
  href: string;
};

export type GrupoBusca = {
  tipo: "reservas" | "kits" | "notebooks" | "ocorrencias" | "professores";
  rotulo: string;
  itens: ResultadoBusca[];
};

/**
 * Busca global.
 *
 * O escopo depende do perfil, e a decisão é tomada aqui no servidor:
 *  - professor encontra apenas as próprias reservas e as ocorrências que ele
 *    registrou, e não consegue pesquisar pessoas — a busca não pode virar uma
 *    lista telefônica do corpo docente;
 *  - supervisão encontra tudo, inclusive por nome de professor.
 *
 * Equipamento (kit e notebook) é visível para os dois perfis: o professor
 * precisa localizar um patrimônio para pedir a reserva. Itens desativados só
 * aparecem para a supervisão, já que ninguém mais pode fazer nada com eles.
 */
export const GET = handle(async (request: Request) => {
  const usuario = await requireUser();
  const { q } = readQuery(request, searchQuerySchema);

  const supervisor = usuario.role === "SUPERVISOR";
  const contem = { contains: q, mode: "insensitive" } as const;

  const [reservas, kits, notebooks, ocorrencias, professores] = await Promise.all(
    [
      prisma.reservation.findMany({
        where: {
          ...(supervisor ? {} : { userId: usuario.id }),
          OR: [
            { code: contem },
            { room: contem },
            { className: contem },
            { purpose: contem },
            // Buscar reserva pelo nome do docente é atribuição da supervisão.
            ...(supervisor ? [{ user: { fullName: contem } }] : []),
          ],
        },
        select: {
          id: true,
          code: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          status: true,
          room: true,
          user: { select: { fullName: true } },
        },
        orderBy: [{ startsAt: "desc" }],
        take: MAX_POR_GRUPO,
      }),
      prisma.kit.findMany({
        where: {
          ...(supervisor ? {} : { status: { not: "DESATIVADO" } }),
          OR: [{ code: contem }, { name: contem }, { location: contem }],
        },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          status: true,
          location: true,
          _count: { select: { notebooks: true } },
        },
        orderBy: { name: "asc" },
        take: MAX_POR_GRUPO,
      }),
      prisma.notebook.findMany({
        where: {
          ...(supervisor ? {} : { status: { not: "DESATIVADO" } }),
          OR: [
            { assetTag: contem },
            { serialNumber: contem },
            { nickname: contem },
            { model: contem },
          ],
        },
        select: {
          id: true,
          assetTag: true,
          nickname: true,
          brand: true,
          model: true,
          status: true,
          kit: { select: { name: true } },
        },
        orderBy: { assetTag: "asc" },
        take: MAX_POR_GRUPO,
      }),
      prisma.incident.findMany({
        where: {
          ...(supervisor ? {} : { reportedById: usuario.id }),
          OR: [{ code: contem }, { description: contem }],
        },
        select: {
          id: true,
          code: true,
          status: true,
          severity: true,
          description: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: MAX_POR_GRUPO,
      }),
      supervisor
        ? prisma.user.findMany({
            where: {
              OR: [{ fullName: contem }, { username: contem }, { email: contem }],
            },
            select: {
              id: true,
              fullName: true,
              username: true,
              department: true,
              role: true,
              active: true,
            },
            orderBy: [{ active: "desc" }, { fullName: "asc" }],
            take: MAX_POR_GRUPO,
          })
        : Promise.resolve([]),
    ],
  );

  const todosGrupos: GrupoBusca[] = [
    {
      tipo: "reservas",
      rotulo: "Reservas",
      itens: reservas.map((reserva) => ({
        id: reserva.id,
        titulo: reserva.code,
        subtitulo: [
          formatIntervalBR(reserva.startsAt, reserva.endsAt, reserva.allDay),
          RESERVATION_STATUS_LABEL[reserva.status],
          supervisor ? reserva.user.fullName : null,
          reserva.room ? `Sala ${reserva.room}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/reservas/${reserva.id}`,
      })),
    },
    {
      tipo: "kits",
      rotulo: "Maletas e carrinhos",
      itens: kits.map((kit) => ({
        id: kit.id,
        titulo: `${kit.name} (${kit.code})`,
        subtitulo: [
          kit.type === "MALETA" ? "Maleta" : "Carrinho",
          `${kit._count.notebooks} notebook(s)`,
          KIT_STATUS_LABEL[kit.status],
          kit.location,
        ]
          .filter(Boolean)
          .join(" · "),
        href: hrefRecurso(usuario, `/admin/kits/${kit.id}`, kitKey(kit.id)),
      })),
    },
    {
      tipo: "notebooks",
      rotulo: "Notebooks",
      itens: notebooks.map((notebook) => ({
        id: notebook.id,
        titulo: `Notebook ${notebook.assetTag}`,
        subtitulo: [
          notebook.nickname,
          [notebook.brand, notebook.model].filter(Boolean).join(" ") || null,
          NOTEBOOK_STATUS_LABEL[notebook.status],
          notebook.kit ? `Kit ${notebook.kit.name}` : "Avulso",
        ]
          .filter(Boolean)
          .join(" · "),
        href: hrefRecurso(
          usuario,
          `/admin/notebooks/${notebook.id}`,
          notebookKey(notebook.id),
        ),
      })),
    },
    {
      tipo: "ocorrencias",
      rotulo: "Ocorrências",
      itens: ocorrencias.map((ocorrencia) => ({
        id: ocorrencia.id,
        titulo: ocorrencia.code,
        subtitulo: [
          INCIDENT_STATUS_LABEL[ocorrencia.status],
          `Severidade ${INCIDENT_SEVERITY_LABEL[ocorrencia.severity]}`,
          resumoTexto(ocorrencia.description),
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/ocorrencias/${ocorrencia.id}`,
      })),
    },
    {
      tipo: "professores",
      rotulo: "Professores",
      itens: professores.map((professor) => ({
        id: professor.id,
        titulo: professor.fullName,
        subtitulo: [
          professor.role === "SUPERVISOR" ? "Supervisão" : "Professor",
          professor.department,
          professor.active ? null : "Conta desativada",
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/admin/usuarios/${professor.id}`,
      })),
    },
  ];

  // Grupo vazio só ocuparia espaço na lista de sugestões.
  const grupos = todosGrupos.filter((grupo) => grupo.itens.length > 0);

  return json({
    termo: q,
    total: grupos.reduce((soma, grupo) => soma + grupo.itens.length, 0),
    grupos,
  });
}, "busca");

/**
 * O destino do resultado depende do que a pessoa pode fazer com ele: a
 * supervisão vai para a ficha do equipamento; o professor, para a tela de
 * disponibilidade já com o recurso selecionado.
 */
function hrefRecurso(
  usuario: SessionUser,
  destinoAdmin: string,
  resourceKey: string,
): string {
  return usuario.role === "SUPERVISOR"
    ? destinoAdmin
    : `/disponibilidade?recurso=${encodeURIComponent(resourceKey)}`;
}

/** Primeira linha da descrição, para caber no subtítulo do resultado. */
function resumoTexto(texto: string, limite = 80): string {
  const linha = texto.split("\n")[0]?.trim() ?? "";
  return linha.length > limite ? `${linha.slice(0, limite - 1)}…` : linha;
}
