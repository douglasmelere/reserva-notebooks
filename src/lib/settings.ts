import { z } from "zod";
import { prisma } from "./db";

/**
 * Configurações administrativas parametrizáveis.
 *
 * Toda decisão de negócio que a especificação deixou em aberto vive aqui, com
 * um padrão razoável, e pode ser alterada pela supervisão sem novo deploy.
 * O schema Zod é a fonte única da verdade: valida a gravação e preenche os
 * campos ausentes na leitura, de modo que um banco antigo continua válido
 * quando novas chaves são adicionadas.
 */
export const settingsSchema = z.object({
  // --- Regras de reserva -------------------------------------------------
  /// Exigir horário inicial/final. Falso => reservas de dia inteiro.
  requireTimeRange: z.boolean().default(true),
  /// Antecedência mínima, em horas, entre agora e o início da reserva.
  minAdvanceHours: z.coerce.number().min(0).max(720).default(0),
  /// Antecedência máxima, em dias, para agendar.
  maxAdvanceDays: z.coerce.number().int().min(1).max(365).default(60),
  /// Permite reservar para o próprio dia.
  allowSameDay: z.boolean().default(true),
  /// Máximo de reservas ativas simultâneas por professor (0 = sem limite).
  maxActiveReservationsPerUser: z.coerce.number().int().min(0).max(100).default(5),
  /// Máximo de recursos em uma única reserva.
  maxResourcesPerReservation: z.coerce.number().int().min(1).max(50).default(5),
  /// Horário de funcionamento (usado para validar e para montar a grade).
  openingTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use o formato HH:MM")
    .default("07:00"),
  closingTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use o formato HH:MM")
    .default("22:00"),
  /// Prazo, em horas antes do início, até quando o professor pode cancelar.
  /// 0 significa que pode cancelar a qualquer momento antes do início.
  cancellationDeadlineHours: z.coerce.number().min(0).max(168).default(0),
  /// Permite cancelar mesmo depois de a reserva ter começado.
  allowCancelAfterStart: z.boolean().default(false),
  /// Permite combinar kits e notebooks avulsos na mesma reserva.
  allowMixedResourceReservation: z.boolean().default(true),

  // --- Carregadores ------------------------------------------------------
  /// Exigir kit de carregadores completo para reservar maleta/carrinho.
  requireCompleteChargerKit: z.boolean().default(false),

  // --- WhatsApp ----------------------------------------------------------
  /// Habilita o botão de contato em conflitos.
  whatsappContactEnabled: z.boolean().default(true),
  /// Modelo da mensagem. Placeholders: {professor}, {recurso}, {periodo},
  /// {solicitante}, {sala}.
  whatsappMessageTemplate: z
    .string()
    .min(10)
    .default(
      "Olá, professor(a) {professor}. Vi que você está utilizando {recurso} em {periodo}. " +
        "Eu precisaria de um kit ou notebook nesse período. Você teria algum equipamento sobrando " +
        "ou poderia verificar a possibilidade de compartilhar?",
    ),
  /// Texto exibido quando não há telefone autorizado.
  whatsappUnavailableMessage: z
    .string()
    .min(5)
    .default(
      "Este docente não disponibilizou contato por WhatsApp. Procure a supervisão para verificar alternativas.",
    ),

  // --- Operação ----------------------------------------------------------
  /// Marca reservas não retiradas como não comparecimento após N horas.
  noShowAfterHours: z.coerce.number().min(0).max(72).default(2),
  /// Nome da instituição, exibido no cabeçalho e no comprovante.
  institutionName: z.string().min(1).default("Instituição de Ensino"),
});

export type Settings = z.infer<typeof settingsSchema>;

/** Padrões usados quando o banco ainda não tem nenhuma configuração. */
export const defaultSettings: Settings = settingsSchema.parse({});

const SETTINGS_KEY = "app";

/**
 * Cache curto em memória: as configurações são lidas em quase toda requisição
 * (validação de reserva, montagem de tela) e mudam raramente.
 */
let cache: { value: Settings; expiresAt: number } | null = null;
const CACHE_TTL_MS = 15_000;

export async function getSettings(): Promise<Settings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const row = await prisma.systemSetting.findUnique({
    where: { key: SETTINGS_KEY },
  });

  // `parse` de um objeto parcial preenche os defaults das chaves ausentes.
  const parsed = settingsSchema.safeParse(row?.value ?? {});
  const value = parsed.success ? parsed.data : defaultSettings;

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function updateSettings(
  patch: Partial<Settings>,
  updatedById: string | null,
): Promise<Settings> {
  const current = await getSettings();
  const next = settingsSchema.parse({ ...current, ...patch });

  await prisma.systemSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: next, updatedById },
    update: { value: next, updatedById },
  });

  cache = { value: next, expiresAt: Date.now() + CACHE_TTL_MS };
  return next;
}

/** Descarta o cache. Usado nos testes e após restaurar um backup. */
export function invalidateSettingsCache(): void {
  cache = null;
}
