"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addDays } from "@/lib/datetime";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/primitives";
import type { DayOccupancy } from "@/server/availability";

/**
 * Grade mensal da agenda.
 *
 * Montada com CSS grid de sete colunas a partir de aritmética de datas civis —
 * sem biblioteca de calendário e sem `Date` local do navegador, que estaria no
 * fuso da máquina do usuário e não no da instituição. Cada dia é um link para a
 * lista já filtrada naquele dia, preservando os demais filtros.
 */

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const DIAS_DA_SEMANA = [
  { curto: "Dom", longo: "domingo" },
  { curto: "Seg", longo: "segunda-feira" },
  { curto: "Ter", longo: "terça-feira" },
  { curto: "Qua", longo: "quarta-feira" },
  { curto: "Qui", longo: "quinta-feira" },
  { curto: "Sex", longo: "sexta-feira" },
  { curto: "Sáb", longo: "sábado" },
];

/** "2026-08" -> "agosto de 2026". */
function nomeDoMes(mes: string): string {
  const indice = Number(mes.slice(5, 7)) - 1;
  return `${MESES[indice] ?? mes} de ${mes.slice(0, 4)}`;
}

/** Mês vizinho, no formato "AAAA-MM". */
function deslocaMes(mes: string, passos: number): string {
  const ano = Number(mes.slice(0, 4));
  const numero = Number(mes.slice(5, 7));
  const total = ano * 12 + (numero - 1) + passos;
  const proximoAno = Math.floor(total / 12);
  const proximoMes = (total % 12) + 1;
  return `${String(proximoAno).padStart(4, "0")}-${String(proximoMes).padStart(2, "0")}`;
}

export function Calendario({
  mes,
  hoje,
  inicioGrade,
  totalCelulas,
  diasNoMes,
  ocupacao,
  baseQuery,
  filtrosAtivos,
}: {
  mes: string;
  hoje: string;
  inicioGrade: string;
  totalCelulas: number;
  diasNoMes: number;
  ocupacao: DayOccupancy[];
  baseQuery: string;
  filtrosAtivos: boolean;
}) {
  const router = useRouter();
  const [pendente, iniciarTransicao] = useTransition();

  const porDia = new Map(ocupacao.map((dia) => [dia.date, dia]));

  const dias = Array.from({ length: totalCelulas }, (_, indice) => {
    const data = addDays(inicioGrade, indice);
    return {
      data,
      diaDoMes: Number(data.slice(8, 10)),
      doMes: data.slice(0, 7) === mes,
      ehHoje: data === hoje,
      ocupacao: porDia.get(data) ?? null,
    };
  });

  const reservasNoMes = dias
    .filter((dia) => dia.doMes)
    .reduce((soma, dia) => soma + (dia.ocupacao?.totalReservas ?? 0), 0);

  const prefixo = baseQuery ? `${baseQuery}&` : "";
  const linkDoDia = (data: string): string =>
    `/admin/reservas?${prefixo}view=lista&from=${data}&to=${data}`;
  const linkDoMes = (proximoMes: string): string =>
    `/admin/reservas?${prefixo}view=calendario&mes=${proximoMes}`;

  function irPara(proximoMes: string): void {
    iniciarTransicao(() => {
      router.push(linkDoMes(proximoMes));
    });
  }

  return (
    <Card>
      <CardHeader
        title={`Agenda de ${nomeDoMes(mes)}`}
        description={
          filtrosAtivos
            ? "A contagem por dia considera todas as reservas ativas; os filtros são aplicados ao abrir o dia."
            : "Cada dia mostra quantas reservas ativas existem. Toque em um dia para ver a lista."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => irPara(deslocaMes(mes, -1))}
              disabled={pendente}
            >
              <span aria-hidden="true">←</span>
              <span className="sr-only">Mês anterior: </span>
              {nomeDoMes(deslocaMes(mes, -1)).split(" de ")[0]}
            </Button>
            <Button
              variant="outline"
              onClick={() => irPara(hoje.slice(0, 7))}
              disabled={pendente || mes === hoje.slice(0, 7)}
            >
              Mês atual
            </Button>
            <Button
              variant="outline"
              onClick={() => irPara(deslocaMes(mes, 1))}
              disabled={pendente}
            >
              <span className="sr-only">Próximo mês: </span>
              {nomeDoMes(deslocaMes(mes, 1)).split(" de ")[0]}
              <span aria-hidden="true">→</span>
            </Button>
          </div>
        }
      />

      <CardBody className="flex flex-col gap-3">
        <p aria-live="polite" className="text-sm text-slate-600">
          {pendente
            ? "Carregando o mês..."
            : `${reservasNoMes} reserva(s) ativa(s) em ${diasNoMes} dia(s) deste mês.`}
        </p>

        {reservasNoMes === 0 && !pendente && (
          <EmptyState
            title="Nenhuma reserva ativa neste mês"
            description="Reservas canceladas e encerradas não ocupam mais equipamento e por isso não aparecem na grade. Use os meses vizinhos ou crie uma reserva em nome de um professor."
          />
        )}

        <div>
          <div
            className="grid grid-cols-7 gap-1 pb-1"
            role="presentation"
            aria-hidden="true"
          >
            {DIAS_DA_SEMANA.map((dia) => (
              <div
                key={dia.curto}
                className="px-1 text-center text-xs font-semibold tracking-wide text-slate-500 uppercase"
              >
                {dia.curto}
              </div>
            ))}
          </div>

          <ul className="grid grid-cols-7 gap-1">
            {dias.map((dia) => {
              const total = dia.ocupacao?.totalReservas ?? 0;
              const descricao =
                total === 0
                  ? "sem reservas"
                  : `${total} reserva${total > 1 ? "s" : ""}`;

              return (
                // `min-w-0` + `overflow-hidden`: numa tela de 360px cada coluna
                // tem menos de 40px, e sem isso o conteúdo do dia vazaria para
                // fora da grade e faria a página inteira rolar na horizontal.
                <li key={dia.data} className="min-w-0">
                  <Link
                    href={linkDoDia(dia.data)}
                    aria-label={`${dia.diaDoMes} de ${nomeDoMes(dia.data.slice(0, 7))}, ${descricao}`}
                    aria-current={dia.ehHoje ? "date" : undefined}
                    className={[
                      "flex min-h-16 flex-col gap-1 overflow-hidden rounded-lg border p-1.5 text-left transition-colors sm:min-h-24 sm:p-2",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600",
                      dia.doMes
                        ? "border-slate-200 bg-white hover:bg-sky-50"
                        : "border-slate-100 bg-slate-50 text-slate-400 hover:bg-slate-100",
                      dia.ehHoje ? "ring-2 ring-sky-600 ring-inset" : "",
                    ].join(" ")}
                  >
                    {/* "hoje" quebra para a linha de baixo no celular em vez de
                        empurrar o número do dia para fora da célula. */}
                    <span className="flex flex-wrap items-baseline gap-x-1">
                      <span
                        className={
                          dia.doMes
                            ? "text-sm font-semibold text-slate-900 tabular-nums"
                            : "text-sm text-slate-400 tabular-nums"
                        }
                      >
                        {dia.diaDoMes}
                      </span>
                      {dia.ehHoje && (
                        <span className="text-[0.65rem] font-medium text-sky-700">
                          hoje
                        </span>
                      )}
                    </span>

                    {total > 0 ? (
                      <span className="flex flex-col gap-0.5">
                        {/* No celular só o número cabe no selo; o rótulo por
                            extenso volta a partir de `sm`. O leitor de tela
                            recebe a frase completa pelo `aria-label` do link. */}
                        <span className="inline-flex w-fit max-w-full items-center rounded-full bg-sky-50 px-1.5 py-0.5 text-[0.7rem] font-semibold text-sky-800 ring-1 ring-sky-200 ring-inset">
                          {total}
                          <span className="hidden sm:inline">
                            &nbsp;reserva{total > 1 ? "s" : ""}
                          </span>
                        </span>
                        <span className="hidden text-[0.7rem] text-slate-500 sm:block">
                          {dia.ocupacao?.kitsOcupados ?? 0} kit(s) ·{" "}
                          {dia.ocupacao?.notebooksOcupados ?? 0} notebook(s)
                        </span>
                      </span>
                    ) : (
                      <span className="hidden text-[0.7rem] text-slate-400 sm:block">
                        livre
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="text-xs text-slate-500">
          O número dentro do selo azul de cada dia é a quantidade de reservas
          daquele dia. A grade conta apenas reservas que ainda ocupam equipamento
          (solicitada, confirmada, retirada e em uso). Dias sem selo estão livres.
        </p>
      </CardBody>
    </Card>
  );
}
