/**
 * Autoria e identificação do sistema.
 *
 * Fonte única: o rodapé, a página "Sobre", o README e o `package.json` leem
 * daqui. Trocar o nome ou o contato de suporte é mexer em um lugar só.
 */
export const CREDITOS = {
  /** Quem desenvolveu. Ajuste aqui se o nome estiver diferente. */
  autor: "Douglas Melere",
  /** Ano de conclusão da primeira versão. */
  ano: 2026,
  /** Instituição para a qual o sistema foi feito. */
  instituicao: "SENAI/SC",
  /** Versão exibida na tela "Sobre". */
  versao: "1.0.0",
  /**
   * Contato de suporte mostrado na tela "Sobre".
   * Deixe `null` para ocultar a seção enquanto não houver um canal definido.
   */
  suporte: null as string | null,
} as const;

/** Linha de crédito curta, usada no rodapé. */
export function linhaDeCredito(): string {
  return `Desenvolvido por ${CREDITOS.autor} · ${CREDITOS.ano}`;
}
