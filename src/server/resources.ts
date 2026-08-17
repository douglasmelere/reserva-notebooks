import { createHash } from "node:crypto";
import type { KitStatus, NotebookStatus } from "@/generated/prisma/enums";

/**
 * Vocabulário compartilhado sobre recursos reserváveis.
 *
 * Kits e notebooks são entidades diferentes, mas do ponto de vista da agenda
 * ambos são "um recurso ocupado em um intervalo". A `resourceKey` unifica os
 * dois em uma única chave de texto, que é o que a restrição EXCLUDE do banco
 * compara.
 */

export type ResourceKind = "kit" | "notebook";

export function kitKey(kitId: string): string {
  return `kit:${kitId}`;
}

export function notebookKey(notebookId: string): string {
  return `notebook:${notebookId}`;
}

export function parseResourceKey(
  key: string,
): { kind: ResourceKind; id: string } | null {
  const [kind, id] = key.split(":", 2);
  if (!id) return null;
  if (kind === "kit" || kind === "notebook") return { kind, id };
  return null;
}

/**
 * Status de kit que permitem reserva.
 * Manutenção, indisponível e desativado ficam fora da disponibilidade.
 */
export const RESERVABLE_KIT_STATUSES: KitStatus[] = ["DISPONIVEL"];

/**
 * Status de notebook que permitem reserva.
 *
 * `RESERVADO` e `EM_USO` descrevem a situação atual do equipamento, não um
 * impedimento de agenda: o que decide se ele pode ser reservado em um período
 * é a existência de outra reserva sobreposta, verificada separadamente. Já
 * manutenção, perdido, indisponível e desativado bloqueiam qualquer reserva.
 */
export const RESERVABLE_NOTEBOOK_STATUSES: NotebookStatus[] = [
  "DISPONIVEL",
  "RESERVADO",
  "EM_USO",
];

export function kitIsReservable(status: KitStatus): boolean {
  return RESERVABLE_KIT_STATUSES.includes(status);
}

export function notebookIsReservable(status: NotebookStatus): boolean {
  return RESERVABLE_NOTEBOOK_STATUSES.includes(status);
}

/** Rótulos em português para exibição e para a mensagem do WhatsApp. */
export const KIT_STATUS_LABEL: Record<KitStatus, string> = {
  DISPONIVEL: "Disponível",
  MANUTENCAO: "Em manutenção",
  INDISPONIVEL: "Indisponível",
  DESATIVADO: "Desativado",
};

export const NOTEBOOK_STATUS_LABEL: Record<NotebookStatus, string> = {
  DISPONIVEL: "Disponível",
  RESERVADO: "Reservado",
  EM_USO: "Em uso",
  MANUTENCAO: "Em manutenção",
  PERDIDO: "Perdido",
  INDISPONIVEL: "Indisponível",
  DESATIVADO: "Desativado",
};

/**
 * Chave de lock consultivo derivada da `resourceKey`.
 *
 * `pg_advisory_xact_lock` recebe um bigint. Derivamos de forma determinística
 * a partir do SHA-256 da chave, em vez de usar a função interna `hashtext` do
 * PostgreSQL, que não é documentada como estável entre versões.
 */
export function advisoryLockKey(resourceKey: string): bigint {
  const digest = createHash("sha256").update(resourceKey).digest();
  // 8 primeiros bytes como inteiro com sinal de 64 bits.
  return digest.readBigInt64BE(0);
}
