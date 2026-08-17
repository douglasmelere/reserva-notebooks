import { z } from "zod";
import { requireSupervisor } from "@/lib/auth";
import { handle, json, readQuery } from "@/lib/http";
import { listQuerySchema, reservationStatusSchema } from "@/lib/validation";
import {
  REPORT_TYPES,
  buildReport,
  reportFileName,
  reportToCsv,
} from "@/server/reports";

export const dynamic = "force-dynamic";

const reportsQuerySchema = listQuerySchema.extend({
  tipo: z.enum(REPORT_TYPES, {
    message: "Relatório desconhecido.",
  }),
  formato: z
    .enum(["json", "csv"], { message: 'Formato inválido: use "json" ou "csv".' })
    .default("json"),
  // Filtros extras do histórico de reservas.
  userId: z
    .string()
    .trim()
    .min(1, "Selecione um professor válido.")
    .max(64, "Identificador de professor inválido.")
    .optional(),
  kitId: z
    .string()
    .trim()
    .min(1, "Selecione uma maleta ou carrinho válido.")
    .max(64, "Identificador de kit inválido.")
    .optional(),
  notebookId: z
    .string()
    .trim()
    .min(1, "Selecione um notebook válido.")
    .max(64, "Identificador de notebook inválido.")
    .optional(),
  status: z
    .union([reservationStatusSchema, z.array(reservationStatusSchema)], {
      message: "Situação de reserva desconhecida.",
    })
    .optional()
    .transform((valor) =>
      valor === undefined ? undefined : Array.isArray(valor) ? valor : [valor],
    ),
});

/**
 * Byte Order Mark UTF-8.
 *
 * Sem ele o Excel em pt-BR abre o arquivo como Windows-1252 e todo acento vira
 * caractere estranho — o relatório chega ilegível para quem vai usá-lo.
 */
// Escrito como escape de propósito: um U+FEFF literal é invisível no editor e
// some no primeiro "trim" distraído.
const BOM_UTF8 = "\uFEFF";

export const GET = handle(async (request: Request) => {
  await requireSupervisor();

  const filtros = readQuery(request, reportsQuerySchema);

  const relatorio = await buildReport(filtros.tipo, {
    from: filtros.from,
    to: filtros.to,
    userId: filtros.userId,
    kitId: filtros.kitId,
    notebookId: filtros.notebookId,
    status: filtros.status,
    search: filtros.search,
  });

  if (filtros.formato === "csv") {
    return new Response(BOM_UTF8 + reportToCsv(relatorio), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${reportFileName(relatorio)}"`,
        "cache-control": "no-store",
      },
    });
  }

  return json(relatorio);
}, "admin.reports");
