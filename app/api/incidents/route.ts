import { z } from "zod";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson, readQuery } from "@/lib/http";
import {
  createIncidentSchema,
  incidentCategorySchema,
  incidentSeveritySchema,
  incidentStatusSchema,
  listQuerySchema,
} from "@/lib/validation";
import { createIncident, listIncidents } from "@/server/incidents";

export const dynamic = "force-dynamic";

/**
 * Filtro de múltipla escolha vindo da query string.
 *
 * Aceita as duas formas que a interface produz — `?status=ABERTA&status=RECORRENTE`
 * e `?status=ABERTA,RECORRENTE` — porque o mesmo filtro é montado ora por
 * checkboxes, ora por um link salvo pelo usuário. Um link salvo com um valor
 * que saiu do vocabulário precisa de um recado em português: a mensagem padrão
 * do Zod ("Invalid option: expected one of ...") iria direto para a tela.
 */
const multiplaEscolha = <T extends z.ZodType>(item: T) =>
  z.preprocess((raw) => {
    if (raw === undefined || raw === null || raw === "") return undefined;
    const valores = (Array.isArray(raw) ? raw : [raw])
      .flatMap((valor) => String(valor).split(","))
      .map((valor) => valor.trim())
      .filter(Boolean);
    return valores.length > 0 ? valores : undefined;
  }, z.array(item).optional());

// Os enums abaixo repetem o vocabulário do esquema compartilhado através de
// `.options` — uma única fonte da lista de valores — só para trocar a mensagem
// padrão do Zod, que sairia em inglês.
const incidentTargetTypeSchema = z.enum(
  ["NOTEBOOK", "KIT", "CHARGER_KIT", "RESERVATION"],
  { error: "Filtro de tipo de item desconhecido." },
);

const listIncidentsQuerySchema = listQuerySchema.extend({
  status: multiplaEscolha(
    z.enum(incidentStatusSchema.options, {
      error: "Filtro de situação desconhecido.",
    }),
  ),
  severity: multiplaEscolha(
    z.enum(incidentSeveritySchema.options, {
      error: "Filtro de severidade desconhecido.",
    }),
  ),
  category: multiplaEscolha(
    z.enum(incidentCategorySchema.options, {
      error: "Filtro de categoria desconhecido.",
    }),
  ),
  targetType: incidentTargetTypeSchema.optional(),
  notebookId: z.string().optional(),
  kitId: z.string().optional(),
  chargerKitId: z.string().optional(),
  reservationId: z.string().optional(),
  assignedToId: z.string().optional(),
  reportedById: z.string().optional(),
});

export const GET = handle(async (request: Request) => {
  const actor = await requireUser();
  const query = readQuery(request, listIncidentsQuerySchema);

  // O recorte por perfil é aplicado dentro de `listIncidents`: o professor pode
  // mandar qualquer filtro daqui e ainda assim só verá o que lhe diz respeito.
  const resultado = await listIncidents(
    {
      status: query.status,
      severity: query.severity,
      category: query.category,
      targetType: query.targetType,
      notebookId: query.notebookId,
      kitId: query.kitId,
      chargerKitId: query.chargerKitId,
      reservationId: query.reservationId,
      assignedToId: query.assignedToId,
      reportedById: query.reportedById,
      from: query.from,
      to: query.to,
      busca: query.search,
      page: query.page,
      pageSize: query.pageSize,
    },
    actor,
  );

  return json(resultado);
}, "ocorrencias.listar");

export const POST = handle(async (request: Request) => {
  const actor = await requireUser();
  await assertSameOrigin();

  const body = await readJson(request, createIncidentSchema);
  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  const resultado = await createIncident(body, actor, { ip, userAgent });

  return json(resultado, { status: 201 });
}, "ocorrencias.registrar");
