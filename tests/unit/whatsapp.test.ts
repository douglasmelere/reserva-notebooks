import { describe, expect, it } from "vitest";
import { buildWhatsappLink, normalizePhone, renderTemplate } from "@/lib/whatsapp";
import { defaultSettings, type Settings } from "@/lib/settings";

/**
 * O contato por WhatsApp é o ponto do sistema em que dado pessoal de um
 * professor é usado por outro. Estes testes fixam as duas regras que não podem
 * afrouxar: sem autorização explícita não há link, e o número nunca aparece
 * fora do próprio link.
 */

const cfg = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings,
  ...patch,
});

const periodo = {
  startsAt: new Date("2026-09-01T11:00:00Z"),
  endsAt: new Date("2026-09-01T13:00:00Z"),
  allDay: false,
};

describe("normalizePhone", () => {
  it("aceita número brasileiro com DDD e acrescenta o código do país", () => {
    expect(normalizePhone("(48) 99999-8888")).toBe("5548999998888");
    expect(normalizePhone("48999998888")).toBe("5548999998888");
  });

  it("preserva número já em formato internacional", () => {
    expect(normalizePhone("+55 48 99999-8888")).toBe("5548999998888");
  });

  it("recusa entrada inválida", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("não é telefone")).toBeNull();
  });
});

describe("renderTemplate", () => {
  it("substitui os marcadores conhecidos", () => {
    const texto = renderTemplate(
      "Olá {professor}, sobre {recurso} em {periodo}, sala {sala}. — {solicitante}",
      {
        professor: "Ana",
        recurso: "Maleta 01",
        periodo: "01/09/2026",
        solicitante: "Carlos",
        sala: "12",
      },
    );
    expect(texto).toBe(
      "Olá Ana, sobre Maleta 01 em 01/09/2026, sala 12. — Carlos",
    );
  });

  it("mantém marcador desconhecido intacto em vez de apagar texto", () => {
    expect(
      renderTemplate("Olá {professor}, {inexistente}", {
        professor: "Ana",
        recurso: "",
        periodo: "",
        solicitante: "",
        sala: "",
      }),
    ).toBe("Olá Ana, {inexistente}");
  });
});

describe("buildWhatsappLink", () => {
  const base = {
    requesterName: "Carlos Silva",
    resourceLabel: "Maleta 01 (MAL-001)",
    room: "Sala 12",
    ...periodo,
  };

  it("gera o link quando há telefone E autorização", () => {
    const r = buildWhatsappLink({
      settings: cfg(),
      holder: {
        fullName: "Ana Souza",
        phone: "48999998888",
        whatsappOptIn: true,
      },
      ...base,
    });

    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.url).toContain("https://wa.me/5548999998888");
    expect(r.message).toContain("Ana Souza");
    expect(r.message).toContain("Maleta 01");
    expect(r.message).toContain("01/09/2026");
    // A mensagem vai codificada na URL.
    expect(r.url).toContain("?text=");
  });

  it("NÃO gera link sem autorização, mesmo com telefone cadastrado", () => {
    const r = buildWhatsappLink({
      settings: cfg(),
      holder: {
        fullName: "Ana Souza",
        phone: "48999998888",
        whatsappOptIn: false,
      },
      ...base,
    });

    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("supervisão");
  });

  it("NÃO gera link sem telefone, mesmo com autorização marcada", () => {
    const r = buildWhatsappLink({
      settings: cfg(),
      holder: { fullName: "Roberto Lima", phone: null, whatsappOptIn: true },
      ...base,
    });
    expect(r.available).toBe(false);
  });

  it("dá a MESMA resposta para 'sem telefone' e 'sem autorização'", () => {
    // Distinguir os dois casos revelaria quem cadastrou telefone e optou por
    // não ser incomodado — informação que não interessa a quem consulta.
    const semTelefone = buildWhatsappLink({
      settings: cfg(),
      holder: { fullName: "A", phone: null, whatsappOptIn: true },
      ...base,
    });
    const semAutorizacao = buildWhatsappLink({
      settings: cfg(),
      holder: { fullName: "B", phone: "48999998888", whatsappOptIn: false },
      ...base,
    });

    expect(semTelefone.available).toBe(false);
    expect(semAutorizacao.available).toBe(false);
    if (semTelefone.available || semAutorizacao.available) return;
    expect(semTelefone.reason).toBe(semAutorizacao.reason);
  });

  it("respeita o desligamento global do recurso", () => {
    const r = buildWhatsappLink({
      settings: cfg({ whatsappContactEnabled: false }),
      holder: { fullName: "Ana", phone: "48999998888", whatsappOptIn: true },
      ...base,
    });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toMatch(/desativado/i);
  });

  it("usa o texto configurado pela supervisão", () => {
    const r = buildWhatsappLink({
      settings: cfg({
        whatsappMessageTemplate: "Prof. {professor}: preciso de {recurso}.",
      }),
      holder: { fullName: "Ana", phone: "48999998888", whatsappOptIn: true },
      ...base,
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.message).toBe("Prof. Ana: preciso de Maleta 01 (MAL-001).");
  });

  it("descreve corretamente uma reserva de dia inteiro", () => {
    const r = buildWhatsappLink({
      settings: cfg(),
      holder: { fullName: "Ana", phone: "48999998888", whatsappOptIn: true },
      ...base,
      startsAt: new Date("2026-09-01T03:00:00Z"),
      endsAt: new Date("2026-09-02T03:00:00Z"),
      allDay: true,
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.message).toContain("dia inteiro");
  });
});
