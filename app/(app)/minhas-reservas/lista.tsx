"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { RESERVATION_STATUS_LABEL } from "@/server/reservation-policy";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Alert, Card, CardBody } from "@/components/ui/primitives";

/** "2026-08-17" → "17/08/2026". Sem fuso: é só reordenar o texto. */
function dataBR(valor: string): string {
  const [ano, mes, dia] = valor.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
}

/**
 * Filtros e paginação de "Minhas reservas".
 *
 * O estado vive na URL, e não no componente: assim o professor pode voltar da
 * tela de detalhe, recarregar a página ou mandar o endereço para a supervisão
 * sem perder o recorte que estava vendo. A lista em si continua sendo
 * renderizada no servidor.
 */

/**
 * `@/server/reservation-policy` é seguro no navegador: ele só depende de
 * `@/lib/errors` e `@/lib/datetime`, sem Prisma nem módulos do Node. Importar
 * os rótulos daqui evita a lista de situações divergir da usada pela API.
 */
const OPCOES_SITUACAO = [
  { value: "ativas", label: "Somente as ativas" },
  ...Object.entries(RESERVATION_STATUS_LABEL).map(([valor, rotulo]) => ({
    value: valor,
    label: rotulo,
  })),
];

export function FiltrosDeReservas({
  situacao,
  de,
  ate,
}: {
  situacao: string;
  de: string;
  ate: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendente, iniciarTransicao] = useTransition();

  function aplicar(mudancas: Record<string, string>) {
    const parametros = new URLSearchParams(searchParams.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor) parametros.set(chave, valor);
      else parametros.delete(chave);
    }
    // Trocar o filtro e continuar na página 5 mostraria "nenhum resultado" sem
    // motivo aparente; qualquer mudança volta para a primeira página.
    parametros.delete("pagina");

    const consulta = parametros.toString();
    iniciarTransicao(() => {
      router.push(consulta ? `${pathname}?${consulta}` : pathname);
    });
  }

  const temFiltro = Boolean(situacao || de || ate);
  // Um período invertido devolve zero resultados sem explicar o motivo; o aviso
  // aponta o campo a corrigir em vez de deixar a lista misteriosamente vazia.
  const periodoInvertido = Boolean(de && ate && de > ate);

  return (
    <Card className="mb-4">
      <CardBody>
        <h2 className="text-sm font-semibold text-slate-800">
          Filtrar minhas reservas
        </h2>

        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField
            label="Situação"
            value={situacao}
            placeholder="Todas as situações"
            options={OPCOES_SITUACAO}
            onChange={(evento) => aplicar({ status: evento.target.value })}
          />
          <TextField
            label="A partir de"
            type="date"
            value={de}
            onChange={(evento) => aplicar({ de: evento.target.value })}
            hint="Considera a data da aula."
          />
          <TextField
            label="Até"
            type="date"
            value={ate}
            onChange={(evento) => aplicar({ ate: evento.target.value })}
            hint="Deixe em branco para não limitar."
          />
        </div>

        {periodoInvertido && (
          <Alert tone="warning" title="Período invertido" className="mt-3">
            A data inicial ({dataBR(de)}) é posterior à final ({dataBR(ate)}),
            então nenhuma reserva pode aparecer. Troque uma das duas datas.
          </Alert>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {temFiltro && (
            <Button
              variant="ghost"
              onClick={() => aplicar({ status: "", de: "", ate: "" })}
            >
              Limpar filtros
            </Button>
          )}
          <span aria-live="polite" className="text-sm text-slate-500">
            {pendente ? "Atualizando a lista..." : ""}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

export function PaginacaoDeReservas({
  pagina,
  totalPaginas,
}: {
  pagina: number;
  totalPaginas: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendente, iniciarTransicao] = useTransition();
  // Guarda qual botão disparou a troca: assim a espera aparece no botão que o
  // professor tocou, e não nos dois ao mesmo tempo.
  const [indoPara, setIndoPara] = useState<"anterior" | "proxima" | null>(null);

  if (totalPaginas <= 1) return null;

  function ir(destino: number, direcao: "anterior" | "proxima") {
    const parametros = new URLSearchParams(searchParams.toString());
    if (destino <= 1) parametros.delete("pagina");
    else parametros.set("pagina", String(destino));

    const consulta = parametros.toString();
    setIndoPara(direcao);
    iniciarTransicao(() => {
      router.push(consulta ? `${pathname}?${consulta}` : pathname);
    });
  }

  return (
    <nav
      aria-label="Paginação das reservas"
      className="mt-6 flex flex-wrap items-center justify-between gap-3"
    >
      <Button
        variant="outline"
        onClick={() => ir(pagina - 1, "anterior")}
        disabled={pagina <= 1 || pendente}
        loading={pendente && indoPara === "anterior"}
      >
        Página anterior
      </Button>
      <p aria-live="polite" className="text-sm text-slate-600">
        {pendente ? "Carregando a página..." : `Página ${pagina} de ${totalPaginas}`}
      </p>
      <Button
        variant="outline"
        onClick={() => ir(pagina + 1, "proxima")}
        disabled={pagina >= totalPaginas || pendente}
        loading={pendente && indoPara === "proxima"}
      >
        Próxima página
      </Button>
    </nav>
  );
}
