/**
 * Ambiente dos testes.
 *
 * Carregado pelo Vitest antes de qualquer arquivo de teste. Define as
 * variáveis que a validação de ambiente exige, apontando para um banco de
 * TESTE separado do banco de desenvolvimento — os testes de integração apagam
 * tabelas, e apontar para o banco errado destruiria os dados de trabalho.
 */

// Baixamos o custo do Argon2 nos testes: cada hash com os parâmetros de
// produção leva dezenas de milissegundos, e a suíte cria dezenas de usuários.
// A segurança do hash não é o que estes testes verificam.
process.env.ARGON2_MEMORY_COST ??= "8192";
process.env.ARGON2_TIME_COST ??= "1";
process.env.ARGON2_PARALLELISM ??= "1";

// `NODE_ENV` é somente-leitura nos tipos do Node; a atribuição em si é válida.
if (!process.env.NODE_ENV) Reflect.set(process.env, "NODE_ENV", "test");
process.env.SESSION_SECRET ??=
  "segredo-de-teste-com-mais-de-32-caracteres-000000";
process.env.APP_URL ??= "http://localhost:3000";
process.env.INSTITUTION_TIMEZONE ??= "America/Sao_Paulo";
process.env.STORAGE_DRIVER ??= "local";

process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ??
  "postgresql://reserva:devpass@localhost:55432/reserva_test?schema=public";

if (!/reserva_test|_test/.test(process.env.DATABASE_URL)) {
  throw new Error(
    "Recusando rodar os testes: DATABASE_URL não aponta para um banco de teste.\n" +
      "Os testes de integração apagam tabelas. Use um banco cujo nome contenha '_test'.",
  );
}
