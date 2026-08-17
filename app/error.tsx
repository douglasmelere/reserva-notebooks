"use client";

import { useEffect } from "react";

/**
 * Erro não tratado em uma página.
 *
 * Mostra uma mensagem útil e um caminho de saída, sem expor detalhes técnicos.
 * O `digest` é o identificador que o Next.js registra no log do servidor —
 * exibi-lo permite que o professor informe à supervisão qual foi o erro, sem
 * revelar nada sobre a falha em si.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        nivel: "erro",
        contexto: "pagina",
        digest: error.digest,
        mensagem: error.message,
      }),
    );
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-4xl" aria-hidden="true">
        ⚠️
      </p>
      <h1 className="text-xl font-semibold text-slate-900">
        Algo deu errado nesta tela
      </h1>
      <p className="text-sm text-slate-600">
        Tente novamente. Se o problema continuar, avise a supervisão informando o
        código abaixo.
      </p>
      {error.digest && (
        <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
          {error.digest}
        </code>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-lg bg-sky-700 px-5 text-sm font-medium text-white hover:bg-sky-800"
        >
          Tentar novamente
        </button>
        <a
          href="/inicio"
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Voltar ao início
        </a>
      </div>
    </main>
  );
}
