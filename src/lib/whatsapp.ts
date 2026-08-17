import { formatIntervalBR } from "./datetime";
import type { Settings } from "./settings";

/**
 * Contato via WhatsApp quando o recurso desejado já está reservado.
 *
 * Regras de privacidade aplicadas aqui, no servidor:
 *  - o telefone só é usado se o docente marcou `whatsappOptIn`;
 *  - o número nunca é devolvido ao cliente — apenas o link `wa.me` pronto,
 *    o que evita que a API vire uma lista de telefones dos professores;
 *  - registramos apenas o evento (quem pediu, para quem, quando), nunca o
 *    conteúdo da conversa.
 *
 * Gerar o link não altera reserva nenhuma nem contorna a disponibilidade: é só
 * um atalho de comunicação entre colegas.
 */

/** Mantém apenas dígitos; `wa.me` espera o número em E.164 sem "+". */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;

  // Número brasileiro digitado sem o código do país (DDD + número).
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export type WhatsappTemplateVars = {
  professor: string;
  recurso: string;
  periodo: string;
  solicitante: string;
  sala: string;
};

export function renderTemplate(
  template: string,
  vars: WhatsappTemplateVars,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key as keyof WhatsappTemplateVars];
    return value ?? match;
  });
}

export type WhatsappLinkInput = {
  settings: Settings;
  holder: {
    fullName: string;
    phone: string | null;
    whatsappOptIn: boolean;
  };
  requesterName: string;
  resourceLabel: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  room?: string | null;
};

export type WhatsappLinkResult =
  | { available: true; url: string; message: string }
  | { available: false; reason: string };

/**
 * Monta o link `wa.me` — ou explica por que ele não está disponível.
 *
 * A mensagem de indisponibilidade é a mesma tanto para "não cadastrou
 * telefone" quanto para "não autorizou contato": o professor que consulta não
 * precisa saber qual dos dois é o caso.
 */
export function buildWhatsappLink(
  input: WhatsappLinkInput,
): WhatsappLinkResult {
  const { settings, holder } = input;

  if (!settings.whatsappContactEnabled) {
    return {
      available: false,
      reason: "O contato por WhatsApp está desativado pela supervisão.",
    };
  }

  if (!holder.whatsappOptIn) {
    return { available: false, reason: settings.whatsappUnavailableMessage };
  }

  const phone = normalizePhone(holder.phone);
  if (!phone) {
    return { available: false, reason: settings.whatsappUnavailableMessage };
  }

  const message = renderTemplate(settings.whatsappMessageTemplate, {
    professor: holder.fullName,
    recurso: input.resourceLabel,
    periodo: formatIntervalBR(input.startsAt, input.endsAt, input.allDay),
    solicitante: input.requesterName,
    sala: input.room ?? "não informada",
  });

  return {
    available: true,
    url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    message,
  };
}
