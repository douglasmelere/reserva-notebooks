import { describe, expect, it } from "vitest";
import {
  updateChargerKitSchema,
  updateKitSchema,
  updateNotebookSchema,
  updateProfileSchema,
  updateReservationSchema,
} from "@/lib/validation";
import { kitPatchSchema } from "@/server/kits";
import { notebookPatchSchema } from "@/server/notebooks";
import { somenteCamposEnviados } from "@/server/users";

/**
 * Guarda contra um bug de perda silenciosa de dados.
 *
 * Os esquemas de texto opcional normalizam `undefined` para `null` — bom para
 * gravar campo vazio como null em vez de string vazia, péssimo para PATCH: um
 * corpo com só `{ room: "Sala 9" }` sai da validação como
 * `{ room: "Sala 9", purpose: null, className: null, ... }` e apagaria tudo o
 * mais. O mesmo vale para campos com `.default()`, que reapareceriam com o
 * valor padrão — editar o nome de um kit em manutenção o devolveria a
 * "disponível", tornando reservável um equipamento quebrado.
 *
 * A defesa é `somenteCamposEnviados`, que mantém apenas as chaves realmente
 * presentes no corpo original. Estes testes fixam os dois lados: que a
 * armadilha existe (para ninguém remover a proteção achando que é supérflua)
 * e que a proteção funciona.
 */

describe("a armadilha existe", () => {
  it("PATCH de reserva com um campo produziria nulls nos demais", () => {
    const validado = updateReservationSchema.parse({ room: "Sala 9" });

    expect(validado.room).toBe("Sala 9");
    // Não foram enviados — e mesmo assim apareceram como null.
    expect(validado.purpose).toBeNull();
    expect(validado.className).toBeNull();
    expect(validado.subject).toBeNull();
    expect(validado.teacherNotes).toBeNull();
  });

  it("PATCH de perfil apagaria e-mail, telefone e departamento", () => {
    const validado = updateProfileSchema.parse({ fullName: "Novo Nome" });
    expect(validado.email).toBeNull();
    expect(validado.phone).toBeNull();
    expect(validado.department).toBeNull();
  });

  it("o esquema base de kit traria o status padrão de volta", () => {
    // Direto de `updateKitSchema`, editar o nome devolveria um kit em
    // manutenção para "disponível" — e um equipamento quebrado voltaria a
    // aparecer como reservável.
    expect(updateKitSchema.parse({ name: "Maleta renomeada" }).status).toBe(
      "DISPONIVEL",
    );
  });
});

describe("os esquemas usados nas rotas são seguros", () => {
  /**
   * Cada domínio se defendeu de um jeito. O que importa é o efeito: um PATCH
   * parcial não pode devolver chave que não foi enviada.
   */

  it("kit: o esquema da rota não reintroduz o status", () => {
    // `kitPatchSchema` sobrescreve o campo com default por um opcional puro.
    const validado = kitPatchSchema.parse({ name: "Maleta renomeada" });
    expect(validado.status).toBeUndefined();
    expect(validado.name).toBe("Maleta renomeada");
  });

  it("notebook: o esquema da rota não reintroduz o status", () => {
    // `.partial()` do Zod NÃO desliga o `.default()`: sem o override, editar o
    // apelido devolveria um notebook em manutenção para "disponível".
    expect(updateNotebookSchema.parse({ nickname: "Apelido" }).status).toBe(
      "DISPONIVEL",
    );

    const validado = notebookPatchSchema.parse({ nickname: "Apelido" });
    expect(validado.status).toBeUndefined();
    expect(validado.brand).toBeUndefined();
    expect(validado.nickname).toBe("Apelido");
  });

  it("carregador: idem", () => {
    const validado = updateChargerKitSchema.parse({ availableQuantity: 8 });
    expect(validado.availableQuantity).toBe(8);
    expect(validado.totalQuantity).toBeUndefined();
    expect(validado.code).toBeUndefined();
  });
});

describe("somenteCamposEnviados protege", () => {
  it("mantém apenas as chaves presentes no corpo original", () => {
    const corpo = { room: "Sala 9" };
    const validado = updateReservationSchema.parse(corpo);

    const patch = somenteCamposEnviados(validado, corpo);

    expect(patch).toEqual({ room: "Sala 9" });
    expect("purpose" in patch).toBe(false);
    expect("className" in patch).toBe(false);
  });

  it("preserva null quando o null foi enviado de propósito", () => {
    // Apagar a sala é uma intenção legítima e precisa continuar funcionando.
    const corpo = { room: null };
    const validado = updateReservationSchema.parse(corpo);

    const patch = somenteCamposEnviados(validado, corpo);
    expect(patch).toEqual({ room: null });
  });

  it("preserva string vazia normalizada para null", () => {
    const corpo = { purpose: "" };
    const validado = updateReservationSchema.parse(corpo);

    const patch = somenteCamposEnviados(validado, corpo);
    expect(patch).toEqual({ purpose: null });
  });

  it("mantém vários campos enviados juntos", () => {
    const corpo = { room: "Sala 9", purpose: "Simulado", className: "9º A" };
    const validado = updateReservationSchema.parse(corpo);

    const patch = somenteCamposEnviados(validado, corpo);
    expect(Object.keys(patch).sort()).toEqual(["className", "purpose", "room"]);
  });

  it("corpo vazio produz patch vazio", () => {
    const corpo = {};
    const validado = updateReservationSchema.parse(corpo);
    expect(somenteCamposEnviados(validado, corpo)).toEqual({});
  });
});
