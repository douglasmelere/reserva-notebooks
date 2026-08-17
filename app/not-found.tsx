import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <h1 className="text-xl font-semibold text-slate-900">
        Página não encontrada
      </h1>
      <p className="text-sm text-slate-600">
        O endereço acessado não existe ou o registro que você procurava foi
        removido.
      </p>
      <Link
        href="/inicio"
        className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-senai-700 px-5 text-sm font-medium text-white hover:bg-senai-800"
      >
        Voltar ao início
      </Link>
    </main>
  );
}
