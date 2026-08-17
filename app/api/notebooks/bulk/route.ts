import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { bulkCreateNotebooksSchema } from "@/lib/validation";
import { bulkCreateNotebooks } from "@/server/notebooks";

export const dynamic = "force-dynamic";

/**
 * Cadastro em lote a partir de prefixo + numeração sequencial.
 *
 * Tudo ou nada: se qualquer patrimônio gerado já existir, nada é gravado e a
 * resposta 409 lista os que colidiram (`detalhes.patrimoniosEmUso`), para o
 * operador ajustar a faixa e repetir.
 *
 * O segmento estático `bulk` tem precedência sobre `[id]` no roteador, então
 * não há ambiguidade com a rota de detalhe.
 */
export const POST = handle(async (request: Request) => {
  const actor = await requireSupervisor();
  await assertSameOrigin();

  const body = await readJson(request, bulkCreateNotebooksSchema);
  const resultado = await bulkCreateNotebooks(body, actor, {
    ip: await getClientIp(),
    userAgent: await getUserAgent(),
  });

  return json(resultado, { status: 201 });
}, "notebooks.criar-lote");
