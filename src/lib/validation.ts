import { z } from "zod";

/**
 * Esquemas de validação compartilhados entre API e formulários.
 *
 * Uma definição só para os dois lados: o formulário valida antes de enviar
 * (feedback imediato) e a rota valida de novo ao receber (garantia real). As
 * mensagens já estão em português para irem direto à tela.
 */

export const idSchema = z.string().min(1, "Identificador obrigatório");

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD");

export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use um horário no formato HH:MM");

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} deve ter no máximo ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : (v ?? null)));

// ---------------------------------------------------------------------------
// Autenticação e usuários
// ---------------------------------------------------------------------------

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "O usuário deve ter ao menos 3 caracteres")
  .max(64, "O usuário deve ter no máximo 64 caracteres")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Use apenas letras, números, ponto, hífen e sublinhado",
  )
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres")
  .max(200, "A senha deve ter no máximo 200 caracteres");

export const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^[\d\s()+-]{10,20}$/,
    "Informe um telefone válido com DDD, ex.: (48) 99999-8888",
  )
  .optional()
  .nullable()
  .transform((v) => (v === "" ? null : (v ?? null)));

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  fullName: z
    .string()
    .trim()
    .min(3, "Informe o nome completo")
    .max(120, "Nome muito longo"),
  email: z
    .string()
    .trim()
    .email("Informe um e-mail válido")
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : (v ?? null))),
  phone: phoneSchema,
  whatsappOptIn: z.boolean().default(false),
  department: optionalText(120, "Departamento/disciplina"),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Informe o usuário").toLowerCase(),
  password: z.string().min(1, "Informe a senha"),
});

export const updateProfileSchema = z.object({
  // Sem a mensagem, o Zod devolve o padrão em inglês ("Too big: expected
  // string to have <=120 characters") e o formulário de perfil mostra isso
  // direto no campo, para o professor.
  fullName: z
    .string()
    .trim()
    .min(3, "Informe o nome completo")
    .max(120, "Nome muito longo")
    .optional(),
  email: z
    .string()
    .trim()
    .email("Informe um e-mail válido")
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : (v ?? null))),
  phone: phoneSchema,
  whatsappOptIn: z.boolean().optional(),
  department: optionalText(120, "Departamento/disciplina"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual"),
  newPassword: passwordSchema,
});

export const adminCreateUserSchema = registerSchema.extend({
  role: z.enum(["PROFESSOR", "SUPERVISOR"]).default("PROFESSOR"),
  active: z.boolean().default(true),
});

export const adminUpdateUserSchema = z.object({
  // As mensagens são obrigatórias: este esquema também roda no navegador, e o
  // padrão do Zod é em inglês ("Too small: expected string to have >=3
  // characters") — texto que ia parar na tela da supervisão.
  fullName: z
    .string()
    .trim()
    .min(3, "Informe o nome completo")
    .max(120, "Nome muito longo")
    .optional(),
  email: z
    .string()
    .trim()
    .email("Informe um e-mail válido")
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : (v ?? null))),
  phone: phoneSchema,
  whatsappOptIn: z.boolean().optional(),
  department: optionalText(120, "Departamento/disciplina"),
  role: z.enum(["PROFESSOR", "SUPERVISOR"]).optional(),
  active: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
  mustChangePassword: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Inventário
// ---------------------------------------------------------------------------

export const kitTypeSchema = z.enum(["MALETA", "CARRINHO"]);
export const kitStatusSchema = z.enum([
  "DISPONIVEL",
  "MANUTENCAO",
  "INDISPONIVEL",
  "DESATIVADO",
]);

export const createKitSchema = z.object({
  code: z.string().trim().min(1, "Informe o código/patrimônio").max(40),
  name: z.string().trim().min(1, "Informe o nome do kit").max(80),
  type: kitTypeSchema,
  capacity: z.coerce
    .number()
    .int("A capacidade deve ser um número inteiro")
    .min(1, "A capacidade deve ser ao menos 1")
    .max(200, "Capacidade muito alta"),
  location: optionalText(120, "Localização"),
  description: optionalText(500, "Descrição"),
  notes: optionalText(500, "Observações"),
  status: kitStatusSchema.default("DISPONIVEL"),
});

export const updateKitSchema = createKitSchema.partial().extend({
  /** Confirma explicitamente reduzir a capacidade abaixo do que já existe. */
  confirmCapacityOverflow: z.boolean().optional(),
});

export const notebookStatusSchema = z.enum([
  "DISPONIVEL",
  "RESERVADO",
  "EM_USO",
  "MANUTENCAO",
  "PERDIDO",
  "INDISPONIVEL",
  "DESATIVADO",
]);

export const createNotebookSchema = z.object({
  assetTag: z.string().trim().min(1, "Informe o patrimônio/etiqueta").max(40),
  serialNumber: optionalText(80, "Número de série"),
  nickname: optionalText(60, "Apelido"),
  brand: optionalText(60, "Marca"),
  model: optionalText(60, "Modelo"),
  kitId: z.string().optional().nullable(),
  status: notebookStatusSchema.default("DISPONIVEL"),
  notes: optionalText(500, "Observações"),
  /** Permite ultrapassar a capacidade do kit com confirmação explícita. */
  confirmCapacityOverflow: z.boolean().optional(),
});

export const updateNotebookSchema = createNotebookSchema.partial();

/** Cadastro em lote: gera notebooks sequenciais a partir de um prefixo. */
export const bulkCreateNotebooksSchema = z.object({
  prefix: z.string().trim().min(1, "Informe o prefixo do patrimônio").max(30),
  startNumber: z.coerce.number().int().min(0).default(1),
  quantity: z.coerce
    .number()
    .int()
    .min(1, "Informe ao menos 1 notebook")
    .max(100, "Cadastre no máximo 100 por vez"),
  padding: z.coerce.number().int().min(0).max(6).default(2),
  kitId: z.string().optional().nullable(),
  brand: optionalText(60, "Marca"),
  model: optionalText(60, "Modelo"),
  status: notebookStatusSchema.default("DISPONIVEL"),
  confirmCapacityOverflow: z.boolean().optional(),
});

export const chargerKitStatusSchema = z.enum([
  "COMPLETO",
  "INCOMPLETO",
  "MANUTENCAO",
  "INDISPONIVEL",
  "DESATIVADO",
]);

export const createChargerKitSchema = z.object({
  code: z.string().trim().min(1, "Informe o código do kit de carregadores").max(40),
  kitId: z.string().optional().nullable(),
  totalQuantity: z.coerce.number().int().min(0).max(200),
  availableQuantity: z.coerce.number().int().min(0).max(200),
  status: chargerKitStatusSchema.optional(),
  missingParts: optionalText(300, "Peças faltantes"),
  notes: optionalText(500, "Observações"),
});

export const updateChargerKitSchema = createChargerKitSchema.partial();

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

export const reservationStatusSchema = z.enum([
  "SOLICITADA",
  "CONFIRMADA",
  "RETIRADA",
  "EM_USO",
  "DEVOLVIDA",
  "ENCERRADA",
  "CANCELADA",
  "NAO_COMPARECEU",
]);

export const createReservationSchema = z
  .object({
    userId: z.string().optional(),
    date: dateSchema,
    startTime: timeSchema.optional().nullable(),
    endTime: timeSchema.optional().nullable(),
    kitIds: z.array(z.string()).default([]),
    notebookIds: z.array(z.string()).default([]),
    purpose: optionalText(200, "Finalidade"),
    className: optionalText(80, "Turma"),
    subject: optionalText(80, "Disciplina"),
    room: optionalText(80, "Sala"),
    requestedNotebooks: z.coerce.number().int().min(1).max(200).optional().nullable(),
    teacherNotes: optionalText(500, "Observações"),
    supervisorNotes: optionalText(500, "Observações da supervisão"),
    status: reservationStatusSchema.optional(),
  })
  .refine((v) => v.kitIds.length + v.notebookIds.length > 0, {
    message: "Selecione ao menos um kit ou notebook",
    path: ["kitIds"],
  })
  .refine((v) => !(v.startTime && !v.endTime) && !(v.endTime && !v.startTime), {
    message: "Informe o horário inicial e o final, ou deixe ambos em branco",
    path: ["endTime"],
  });

export const updateReservationSchema = z.object({
  date: dateSchema.optional(),
  startTime: timeSchema.optional().nullable(),
  endTime: timeSchema.optional().nullable(),
  kitIds: z.array(z.string()).optional(),
  notebookIds: z.array(z.string()).optional(),
  purpose: optionalText(200, "Finalidade"),
  className: optionalText(80, "Turma"),
  subject: optionalText(80, "Disciplina"),
  room: optionalText(80, "Sala"),
  requestedNotebooks: z.coerce.number().int().min(1).max(200).optional().nullable(),
  teacherNotes: optionalText(500, "Observações"),
  supervisorNotes: optionalText(500, "Observações da supervisão"),
  status: reservationStatusSchema.optional(),
  changeReason: optionalText(300, "Motivo da alteração"),
});

export const cancelReservationSchema = z.object({
  reason: optionalText(300, "Motivo"),
});

export const closeReservationSchema = z.object({
  allGood: z.boolean(),
  notes: optionalText(500, "Observações"),
  status: z.enum(["DEVOLVIDA", "ENCERRADA", "NAO_COMPARECEU"]).optional(),
  /** Ocorrência opcional registrada junto com a devolução. */
  incident: z
    .object({
      targetType: z.enum(["NOTEBOOK", "KIT", "CHARGER_KIT", "RESERVATION"]),
      notebookId: z.string().optional().nullable(),
      kitId: z.string().optional().nullable(),
      chargerKitId: z.string().optional().nullable(),
      category: z.string(),
      severity: z.enum(["BAIXA", "MEDIA", "ALTA", "CRITICA"]),
      description: z.string().trim().min(5, "Descreva o problema"),
    })
    .optional()
    .nullable(),
});

export const availabilityQuerySchema = z.object({
  date: dateSchema,
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  kitType: kitTypeSchema.optional(),
  location: z.string().trim().max(120).optional(),
  minCapacity: z.coerce.number().int().min(1).max(200).optional(),
  includeUnavailable: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
  onlyStandaloneNotebooks: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
  search: z.string().trim().max(80).optional(),
});

// ---------------------------------------------------------------------------
// Ocorrências
// ---------------------------------------------------------------------------

export const incidentCategorySchema = z.enum([
  "HARDWARE",
  "CARREGADOR",
  "BATERIA",
  "TELA",
  "TECLADO",
  "TOUCHPAD",
  "REDE",
  "SISTEMA",
  "SOFTWARE",
  "DANO_FISICO",
  "LIMPEZA",
  "ACESSORIO_AUSENTE",
  "DEVOLUCAO_INCOMPLETA",
  "NOTEBOOK_FALTANTE",
  "CARREGADOR_FALTANTE",
  "OUTRO",
]);

export const incidentSeveritySchema = z.enum(["BAIXA", "MEDIA", "ALTA", "CRITICA"]);

export const incidentStatusSchema = z.enum([
  "ABERTA",
  "EM_ANALISE",
  "EM_MANUTENCAO",
  "RESOLVIDA",
  "DESCARTADA",
  "RECORRENTE",
]);

export const createIncidentSchema = z
  .object({
    targetType: z.enum(["NOTEBOOK", "KIT", "CHARGER_KIT", "RESERVATION"]),
    notebookId: z.string().optional().nullable(),
    kitId: z.string().optional().nullable(),
    chargerKitId: z.string().optional().nullable(),
    reservationId: z.string().optional().nullable(),
    category: incidentCategorySchema,
    severity: incidentSeveritySchema,
    description: z
      .string()
      .trim()
      .min(5, "Descreva o problema com pelo menos 5 caracteres")
      .max(2000),
    /** Marca o recurso como indisponível junto com o registro. */
    blockResource: z.boolean().default(false),
  })
  .refine(
    (v) =>
      (v.targetType === "NOTEBOOK" && v.notebookId) ||
      (v.targetType === "KIT" && v.kitId) ||
      (v.targetType === "CHARGER_KIT" && v.chargerKitId) ||
      (v.targetType === "RESERVATION" && v.reservationId),
    { message: "Selecione o item relacionado à ocorrência", path: ["targetType"] },
  );

export const updateIncidentSchema = z.object({
  category: incidentCategorySchema.optional(),
  severity: incidentSeveritySchema.optional(),
  status: incidentStatusSchema.optional(),
  assignedToId: z.string().optional().nullable(),
  resolution: optionalText(2000, "Solução aplicada"),
  description: z.string().trim().min(5).max(2000).optional(),
  blockResource: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Configurações e filtros
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});
