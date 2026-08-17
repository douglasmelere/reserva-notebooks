import { auditSafe, diffChanges } from "@/lib/audit";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
} from "@/lib/auth";
import { dadosInvalidos } from "@/lib/errors";
import { handle, json, readJson } from "@/lib/http";
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

/**
 * Atualização parcial.
 *
 * `settingsSchema.partial()` aceita apenas as chaves conhecidas e aplica as
 * mesmas validações da gravação completa — enviar `maxAdvanceDays: 9999` é
 * recusado aqui, não no banco.
 */
export const PATCH = handle(async (request: Request) => {
  const supervisor = await requireSupervisor();
  await assertSameOrigin();

  const patch = await readJson(request, settingsSchema.partial());

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
