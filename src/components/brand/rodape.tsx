import Link from "next/link";
import { cn } from "@/lib/cn";
import { CREDITOS, linhaDeCredito } from "./creditos";

/**
 * Rodapé institucional.
 *
 * Discreto de propósito: em sistema de uso diário, o rodapé compete com o
 * conteúdo se pesar demais. Fica no fim do fluxo, com contraste suficiente para
 * ser lido (`text-slate-500` sobre fundo claro passa em AA para texto pequeno)
 * mas sem disputar atenção com a tela.
 */
export function Rodape({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "mt-10 border-t border-slate-200 px-4 py-5 text-xs text-slate-500 sm:px-6",
        className,
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p>
          {CREDITOS.instituicao} · Reserva de Notebooks, Maletas e Carrinhos
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{linhaDeCredito()}</span>
          <Link
            href="/sobre"
            className="font-medium text-senai-700 underline-offset-2 hover:underline"
          >
            Sobre o sistema
          </Link>
        </p>
      </div>
    </footer>
  );
}
