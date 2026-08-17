import { randomBytes } from "node:crypto";

/**
 * Códigos curtos e legíveis para reservas e ocorrências.
 *
 * Alfabeto sem caracteres ambíguos (0/O, 1/I/L) — o código é lido em voz alta
 * no balcão e digitado na busca.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export function reservationCode(): string {
  return `RS-${randomCode(6)}`;
}

export function incidentCode(): string {
  return `OC-${randomCode(6)}`;
}

/**
 * Tenta gerar um código único.
 *
 * O espaço é grande (31^6 ≈ 887 milhões), mas colisão é possível; em vez de
 * confiar na sorte, tentamos algumas vezes e deixamos a restrição UNIQUE do
 * banco como palavra final.
 */
export async function uniqueCode(
  generate: () => string,
  exists: (code: string) => Promise<boolean>,
  attempts = 5,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const code = generate();
    if (!(await exists(code))) return code;
  }
  // Último recurso: sufixo maior, praticamente livre de colisão.
  return `${generate()}${randomCode(4)}`;
}
