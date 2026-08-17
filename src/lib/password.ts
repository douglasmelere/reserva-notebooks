import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import type { Algorithm } from "@node-rs/argon2";
import { getEnv } from "./env";

/**
 * `Algorithm` é um `const enum` ambiente e não pode ser lido em tempo de
 * execução com `isolatedModules` (exigido pelo bundler). O valor 2 é o
 * Argon2id, conforme a definição do próprio pacote.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * Hashing de senhas com Argon2id.
 *
 * Parâmetros seguem a recomendação OWASP (Argon2id, m=19 MiB, t=2, p=1) e
 * ficam ajustáveis por variável de ambiente para permitir endurecer o custo
 * conforme o hardware da VPS.
 */
function options() {
  const env = getEnv();
  return {
    algorithm: ARGON2ID,
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  } as const;
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, options());
}

export async function verifyPassword(
  digest: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2Verify(digest, plain, options());
  } catch {
    // Hash malformado/algoritmo desconhecido nunca deve derrubar o login.
    return false;
  }
}

/**
 * Hash descartável usado quando o usuário não existe.
 *
 * Sem isso, um login inexistente responde muito mais rápido que um login com
 * senha errada, e essa diferença de tempo revela quais contas existem. Fazemos
 * o mesmo trabalho de verificação nos dois caminhos.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$J4moa2MFTCUwXwCkWaCJmZ4vHFmZFRoPCZ0wNfWHKtA";

export async function fakeVerify(plain: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plain);
}
