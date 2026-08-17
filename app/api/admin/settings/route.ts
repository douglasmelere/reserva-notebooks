import { z } from "zod";
import { auditSafe, diffChanges } from "@/lib/audit";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
} from "@/lib/auth";
import { dadosInvalidos } from "@/lib/errors";
import { fromZodError, handle, json, readJson } from "@/lib/http";
import {
  defaultSettings,
  getSettings,
  settingsSchema,
  updateSettings,
  type Settings,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Configurações administrativas.
 *
 * O GET devolve também os padrões de fábrica: a tela mostra "valor atual x
 * padrão" e permite restaurar um campo sem que o cliente precise conhecer as
 * regras de negócio embutidas no schema.
 */
export const GET = handle(async () => {
  await requireSupervisor();

  return json({
    configuracoes: await getSettings(),
    padroes: defaultSettings,
  });
}, "admin.settings");

const partialSettingsSchema = settingsSchema.partial();

/** Chaves reconhecidas; qualquer outra coisa no corpo é simplesmente ignorada. */
const CHAVES_CONHECIDAS = new Set(Object.keys(settingsSchema.shape));

/**
 * Atualização parcial.
 *
 * Armadilha do Zod: `settingsSchema.partial()` valida cada campo isoladamente,
 * mas os `.default()` do schema continuam disparando — o resultado do parse vem
 * com TODAS as chaves preenchidas. Aplicá-lo direto restauraria os padrões de
 * fábrica em tudo que o formulário não enviou. Por isso lemos o corpo bruto
 * para saber quais chaves o cliente realmente mandou e recortamos o patch a
 * partir delas; a validação de valores continua sendo a do schema.
 */
export const PATCH = handle(async (request: Request) => {
  const supervisor = await requireSupervisor();
  await assertSameOrigin();

  const corpo = await readJson(request, z.record(z.string(), z.unknown()));

  const validado = partialSettingsSchema.safeParse(corpo);
  if (!validado.success) throw fromZodError(validado.error);

  const patch = Object.fromEntries(
    Object.entries(validado.data).filter(
      ([chave]) => CHAVES_CONHECIDAS.has(chave) && chave in corpo,
    ),
  ) as Partial<Settings>;

  if (Object.keys(patch).length === 0) {
    throw dadosInvalidos("Informe ao menos uma configuração para alterar.");
  }

  const antes = await getSettings();
  const depois = await updateSettings(patch, supervisor.id);

  // Só o que realmente mudou entra no histórico: a supervisão precisa enxergar
  // a alteração, não a configuração inteira repetida a cada salvamento.
  const mudancas = diffChanges<Settings>(antes, patch);

  await auditSafe({
    actorId: supervisor.id,
    action: "configuracao.atualizar",
    entity: "SystemSetting",
    entityId: "app",
    summary:
      mudancas.changedKeys.length > 0
        ? `Configurações alteradas: ${mudancas.changedKeys.join(", ")}`
        : "Configurações salvas sem alteração de valor",
    before: mudancas.before,
    after: mudancas.after,
    ip: await getClientIp(),
    userAgent: await getUserAgent(),
  });

  return json({ configuracoes: depois, padroes: defaultSettings });
}, "admin.settings");
