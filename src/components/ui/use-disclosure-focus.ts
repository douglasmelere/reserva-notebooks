"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Disclosure em que o painel SUBSTITUI o gatilho — por exemplo, o botão
 * "Editar cadastro" que dá lugar ao formulário de edição.
 *
 * Como o botão sai do DOM ao abrir, o foco do teclado cairia no `<body>`: quem
 * navega sem mouse teria de tabular desde o topo da página até reencontrar o
 * formulário que acabou de pedir. O hook leva o foco para o painel ao abrir e o
 * devolve ao gatilho ao fechar, que é o que o `<dialog>` nativo já faz nos
 * diálogos de confirmação.
 *
 * O painel precisa de `tabIndex={-1}` (para poder receber foco por script sem
 * entrar na ordem de tabulação) e de um nome acessível, para que o leitor de
 * tela anuncie onde o foco parou.
 */
export function useDisclosureFocus<
  Painel extends HTMLElement = HTMLDivElement,
  Gatilho extends HTMLElement = HTMLButtonElement,
>() {
  const [aberto, setAberto] = useState(false);
  const painelRef = useRef<Painel>(null);
  const gatilhoRef = useRef<Gatilho>(null);

  // Sem isto o gatilho receberia foco na primeira renderização, roubando-o de
  // onde a pessoa estivesse — o efeito só deve agir depois de uma interação.
  const interagiu = useRef(false);

  useEffect(() => {
    if (!interagiu.current) return;
    if (aberto) painelRef.current?.focus();
    else gatilhoRef.current?.focus();
  }, [aberto]);

  const abrir = useCallback(() => {
    interagiu.current = true;
    setAberto(true);
  }, []);

  const fechar = useCallback(() => {
    interagiu.current = true;
    setAberto(false);
  }, []);

  return { aberto, abrir, fechar, painelRef, gatilhoRef };
}
