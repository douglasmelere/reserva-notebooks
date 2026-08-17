import type { z } from "zod";
import { auditSafe } from "@/lib/audit";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { incidentCode, uniqueCode } from "@/lib/codes";
import { prisma } from "@/lib/db";
import { dadosInvalidos } from "@/lib/errors";
import { handle, json, readJson } from "@/lib/http";
import { closeReservationSchema, incidentCategorySchema } from "@/lib/validation";
import {
  closeReservation,
  getReservation,
  type ReservationWithRelations,
} from "@/server/reservations";
import { serializeReservation } from "@/server/whatsapp-contact";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type IncidentPayload = NonNullable<
  z.infer<typeof closeReservationSchema>["incident"]
>;

/**
 * Descobre a qual registro a ocorrência se refere e recusa alvos fora desta
 * reserva.
 *
 * Sem essa amarração, a devolução viraria uma porta lateral para abrir
 * ocorrência em qualquer equipamento do inventário — inclusive em um que o
 * docente nunca teve em mãos.
 */
async function resolveIncidentTarget(
  reservation: ReservationWithRelations,
  incident: IncidentPayload,
): Promise<{
  notebookId: string | null;
  kitId: string | null;
  chargerKitId: string | null;
}> {
  const kitIds = new Set(
    reservation.items
      .map((item) => item.kitId)
      .filter((value): value is string => value !== null),
  );
  const notebookIds = new Set(
    reservation.items
      .map((item) => item.notebookId)
      .filter((value): value is string => value !== null),
  );

  const foraDaReserva = (campo: string, mensagem: string) =>
    dadosInvalidos(mensagem, { [`incident.${campo}`]: [mensagem] });

  switch (incident.targetType) {
    case "RESERVATION":
      // Problema do atendimento em si (atraso, devolução incompleta sem item
      // identificado): fica ligado apenas à reserva.
      return { notebookId: null, kitId: null, chargerKitId: null };

    case "KIT": {
      const kitId = incident.kitId;
      if (!kitId || !kitIds.has(kitId)) {
        throw foraDaReserva(
          "kitId",
          "Selecione uma maleta ou carrinho que faz parte desta reserva.",
        );
      }
      return { notebookId: null, kitId, chargerKitId: null };
    }

    case "NOTEBOOK": {
      const notebookId = incident.notebookId;
      if (!notebookId) {
        throw foraDaReserva("notebookId", "Selecione o notebook com problema.");
      }
      if (!notebookIds.has(notebookId)) {
        // Notebook que veio dentro da maleta/carrinho reservado também conta:
        // ele não aparece como item próprio da reserva, mas esteve com o
        // docente e é justamente onde os defeitos costumam ser notados.
        const notebook = await prisma.notebook.findUnique({
          where: { id: notebookId },
          select: { kitId: true },
        });
        if (!notebook?.kitId || !kitIds.has(notebook.kitId)) {
          throw foraDaReserva(
            "notebookId",
            "Selecione um notebook que faz parte desta reserva.",
          );
        }
      }
      return { notebookId, kitId: null, chargerKitId: null };
    }

    case "CHARGER_KIT": {
      const chargerKitId = incident.chargerKitId;
      if (!chargerKitId) {
        throw foraDaReserva(
          "chargerKitId",
          "Selecione o kit de carregadores com problema.",
        );
      }
      const chargerKit = await prisma.chargerKit.findUnique({
        where: { id: chargerKitId },
        select: { kitId: true },
      });
      if (!chargerKit?.kitId || !kitIds.has(chargerKit.kitId)) {
        throw foraDaReserva(
          "chargerKitId",
          "Selecione um kit de carregadores que faz parte desta reserva.",
        );
      }
      return { notebookId: null, kitId: null, chargerKitId };
    }
  }
}

/**
 * Encerramento da reserva (devolução).
 *
 * Aceita registrar, na mesma ação, a ocorrência constatada na devolução — que
 * é o momento em que o problema aparece. A ocorrência nasce ABERTA e não
 * bloqueia o equipamento: tirar um recurso de circulação é decisão da
 * supervisão, na tela de ocorrências, e não de quem devolveu.
 */
export const POST = handle(async (request: Request, { params }: RouteContext) => {
  const user = await requireUser();
  await assertSameOrigin();
  const { id } = await params;

  const body = await readJson(request, closeReservationSchema);
  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  // Carregar antes de encerrar valida o acesso (404 para reserva de outro
  // docente) e permite recusar uma ocorrência inválida sem já ter encerrado.
  const existing = await getReservation(id, user);

  let incidentData:
    | {
        targetType: IncidentPayload["targetType"];
        severity: IncidentPayload["severity"];
        description: string;
        category: z.infer<typeof incidentCategorySchema>;
        notebookId: string | null;
        kitId: string | null;
        chargerKitId: string | null;
      }
    | null = null;

  if (body.incident) {
    // `closeReservationSchema` recebe a categoria como texto livre; a lista
    // válida é a do enum, validada aqui antes de tocar no banco.
    const category = incidentCategorySchema.safeParse(body.incident.category);
    if (!category.success) {
      throw dadosInvalidos("Selecione uma categoria válida para a ocorrência.", {
        "incident.category": ["Categoria de ocorrência desconhecida."],
      });
    }

    const target = await resolveIncidentTarget(existing, body.incident);
    incidentData = {
      targetType: body.incident.targetType,
      severity: body.incident.severity,
      description: body.incident.description,
      category: category.data,
      ...target,
    };
  }

  const updated = await closeReservation(
    id,
    {
      // Registrar ocorrência e dizer que "correu tudo bem" se contradizem; a
      // ocorrência é o fato concreto e define o resumo gravado na auditoria.
      allGood: body.allGood && !incidentData,
      notes: body.notes,
      status: body.status,
    },
    user,
    { ip, userAgent },
  );

  if (!incidentData) {
    return json({ reservation: serializeReservation(updated), incident: null });
  }

  try {
    const code = await uniqueCode(incidentCode, async (candidate) =>
      Boolean(await prisma.incident.findUnique({ where: { code: candidate } })),
    );

    const incident = await prisma.incident.create({
      data: {
        code,
        targetType: incidentData.targetType,
        notebookId: incidentData.notebookId,
        kitId: incidentData.kitId,
        chargerKitId: incidentData.chargerKitId,
        reservationId: id,
        reportedById: user.id,
        category: incidentData.category,
        severity: incidentData.severity,
        description: incidentData.description,
      },
      select: {
        id: true,
        code: true,
        targetType: true,
        notebookId: true,
        kitId: true,
        chargerKitId: true,
        category: true,
        severity: true,
        status: true,
        description: true,
        createdAt: true,
      },
    });

    await auditSafe({
      actorId: user.id,
      action: "ocorrencia.criar",
      entity: "Incident",
      entityId: incident.id,
      summary: `Ocorrência ${incident.code} registrada na devolução da reserva ${updated.code}`,
      after: {
        code: incident.code,
        targetType: incident.targetType,
        category: incident.category,
        severity: incident.severity,
        reservationId: id,
      },
      ip,
      userAgent,
    });

    return json({ reservation: serializeReservation(updated), incident });
  } catch (error) {
    // A devolução já foi gravada e é o que libera o equipamento para a próxima
    // aula; desfazê-la por causa da ocorrência seria pior. Avisamos para que o
    // problema seja registrado na tela de ocorrências.
    console.error(
      JSON.stringify({
        nivel: "erro",
        contexto: "reservas.encerrar.ocorrencia",
        reservaId: id,
        mensagem: error instanceof Error ? error.message : String(error),
      }),
    );

    return json({
      reservation: serializeReservation(updated),
      incident: null,
      aviso:
        "A devolução foi registrada, mas não foi possível salvar a ocorrência. Registre-a em Ocorrências para que a supervisão seja avisada.",
    });
  }
}, "reservas.encerrar");
