"use client";

import { cn } from "@/lib/cn";

/**
 * Indicador de etapas do fluxo de reserva.
 *
 * O professor precisa saber onde está e quanto falta antes de investir tempo
 * preenchendo — por isso o número da etapa aparece como texto, e não apenas
 * como uma barra colorida: cor e posição sozinhas não informam quem usa leitor
 * de tela nem quem não distingue tons.
 */

export type Etapa = {
  numero: number;
  /** Título curto, usado nas pastilhas. */
  titulo: string;
  /** Frase que explica o que se decide aqui. */
  resumo: string;
};

export const ETAPAS: Etapa[] = [
  { numero: 1, titulo: "Data", resumo: "Escolha o dia da aula" },
  { numero: 2, titulo: "Horário", resumo: "Defina o período de uso" },
  {
    numero: 3,
    titulo: "Tipo",
    resumo: "Kit completo, notebooks avulsos ou os dois",
  },
  { numero: 4, titulo: "Equipamentos", resumo: "Selecione o que está livre" },
  { numero: 5, titulo: "Dados da aula", resumo: "Finalidade, turma e sala" },
  { numero: 6, titulo: "Revisão", resumo: "Confira antes de confirmar" },
  { numero: 7, titulo: "Confirmação", resumo: "Envie o pedido de reserva" },
  { numero: 8, titulo: "Comprovante", resumo: "Guarde o código da reserva" },
];

export const TOTAL_ETAPAS = ETAPAS.length;

export function etapaPorNumero(numero: number): Etapa {
  // Fallback defensivo: a navegação é controlada pelo assistente, mas indexar
  // um array nunca deve derrubar a tela inteira.
  return ETAPAS.find((etapa) => etapa.numero === numero) ?? ETAPAS[0]!;
}

export function IndicadorDeEtapas({
  atual,
  maiorLiberada,
  onIr,
  className,
}: {
  atual: number;
  /** Última etapa já alcançada: só até ela é possível voltar por atalho. */
  maiorLiberada: number;
  onIr: (numero: number) => void;
  className?: string;
}) {
  const etapa = etapaPorNumero(atual);
  const percentual = Math.round((atual / TOTAL_ETAPAS) * 100);

  return (
    <nav aria-label="Progresso da reserva" className={cn("mb-6", className)}>
      <p
        // Anunciado a cada avanço, sem precisar procurar visualmente onde está.
        aria-live="polite"
        className="text-sm font-semibold text-slate-800"
      >
        Etapa {atual} de {TOTAL_ETAPAS} — {etapa.titulo}
      </p>
      <p className="mt-0.5 text-sm text-slate-600">{etapa.resumo}</p>

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={TOTAL_ETAPAS}
        aria-valuenow={atual}
        aria-valuetext={`Etapa ${atual} de ${TOTAL_ETAPAS}: ${etapa.titulo}`}
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full rounded-full bg-sky-700 transition-[width]"
          style={{ width: `${percentual}%` }}
        />
      </div>

      {/* Pastilhas: atalho para revisar uma etapa já preenchida. Envolvem-se em
          várias linhas em telas estreitas, então a página nunca rola na horizontal. */}
      <ol className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
        {ETAPAS.map((item) => {
          const concluida = item.numero < atual;
          const ativa = item.numero === atual;
          const acessivel = item.numero <= maiorLiberada && !ativa;

          return (
            <li key={item.numero}>
              <button
                type="button"
                onClick={() => acessivel && onIr(item.numero)}
                disabled={!acessivel}
                aria-current={ativa ? "step" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700",
                  ativa && "bg-sky-700 text-white",
                  !ativa && concluida && "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
                  !ativa && !concluida && "bg-slate-100 text-slate-500",
                  acessivel ? "cursor-pointer hover:brightness-95" : "cursor-default",
                )}
              >
                <span aria-hidden="true" className="font-bold">
                  {concluida ? "✓" : item.numero}
                </span>
                <span>{item.titulo}</span>
                {concluida && <span className="sr-only">(concluída)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
