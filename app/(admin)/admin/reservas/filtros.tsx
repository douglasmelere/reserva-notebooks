"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { FormEvent } from "react";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { RESERVATION_STATUS_LABEL } from "@/server/reservation-policy";

/**
 * Filtros da agenda.
 *
 * Todo filtro vive na URL, e não no estado do componente: assim a supervisão
 * pode mandar "as reservas canceladas da semana passada" para um colega por
 * link, voltar pelo botão do navegador e recarregar a página sem perder o
 * recorte. O formulário aqui é só a maneira confortável de montar essa URL.
 */

export type OpcaoFiltro = { id: string; nome: string };

export type ValoresDeFiltro = {
  from: string;
  to: string;
  status: ReservationStatus[];
  userId: string;
  kitId: string;
  notebookId: string;
  search: string;
};

const STATUS_DISPONIVEIS = Object.entries(RESERVATION_STATUS_LABEL) as [
  ReservationStatus,
  string,
][];

export function Filtros({
  view,
  mes,
  valores,
  professores,
  kits,
  notebooks,
  avisoNotebooks,
}: {
  view: "lista" | "calendario";
  mes: string;
  valores: ValoresDeFiltro;
  professores: OpcaoFiltro[];
  kits: OpcaoFiltro[];
  notebooks: OpcaoFiltro[];
  avisoNotebooks: string | null;
}) {
  const router = useRouter();
  const [pendente, iniciarTransicao] = useTransition();

  const [form, setForm] = useState<ValoresDeFiltro>(valores);

  // A URL é a fonte da verdade: navegar para trás, clicar num dia do calendário
  // ou limpar os filtros precisa ser refletido nos campos.
  const assinatura = JSON.stringify(valores);
  useEffect(() => {
    setForm(JSON.parse(assinatura) as ValoresDeFiltro);
  }, [assinatura]);

  function navegar(proximos: ValoresDeFiltro): void {
    const params = new URLSearchParams();
    if (proximos.from) params.set("from", proximos.from);
    if (proximos.to) params.set("to", proximos.to);
    if (proximos.userId) params.set("userId", proximos.userId);
    if (proximos.kitId) params.set("kitId", proximos.kitId);
    if (proximos.notebookId) params.set("notebookId", proximos.notebookId);
    if (proximos.search) params.set("search", proximos.search);
    for (const status of proximos.status) params.append("status", status);
    params.set("view", view);
    if (view === "calendario") params.set("mes", mes);

    iniciarTransicao(() => {
      router.push(`/admin/reservas?${params.toString()}`);
    });
  }

  function aoEnviar(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault();
    navegar(form);
  }

  function alternarStatus(status: ReservationStatus, marcado: boolean): void {
    setForm((atual) => ({
      ...atual,
      status: marcado
        ? [...atual.status, status]
        : atual.status.filter((item) => item !== status),
    }));
  }

  const temFiltro =
    Boolean(
      form.from || form.to || form.userId || form.kitId || form.notebookId || form.search,
    ) || form.status.length > 0;

  return (
    <Card>
      <CardHeader
        title="Filtrar reservas"
        description="Combine período, situação, professor e equipamento para encontrar uma reserva específica."
      />
      <CardBody>
        <form onSubmit={aoEnviar} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextField
              label="Data inicial"
              type="date"
              value={form.from}
              max={form.to || undefined}
              onChange={(evento) =>
                setForm((atual) => ({ ...atual, from: evento.target.value }))
              }
              hint="A partir de (inclusive)."
            />
            <TextField
              label="Data final"
              type="date"
              value={form.to}
              min={form.from || undefined}
              onChange={(evento) =>
                setForm((atual) => ({ ...atual, to: evento.target.value }))
              }
              hint="Até (inclusive)."
            />
            <SelectField
              label="Professor"
              placeholder="Todos os professores"
              value={form.userId}
              options={professores.map((professor) => ({
                value: professor.id,
                label: professor.nome,
              }))}
              onChange={(evento) =>
                setForm((atual) => ({ ...atual, userId: evento.target.value }))
              }
            />
            <TextField
              label="Buscar"
              type="search"
              value={form.search}
              placeholder="Código, sala, turma ou finalidade"
              onChange={(evento) =>
                setForm((atual) => ({ ...atual, search: evento.target.value }))
              }
              hint="Também encontra pelo nome do professor."
            />
            <SelectField
              label="Kit (maleta ou carrinho)"
              placeholder="Todos os kits"
              value={form.kitId}
              options={kits.map((kit) => ({ value: kit.id, label: kit.nome }))}
              onChange={(evento) =>
                setForm((atual) => ({ ...atual, kitId: evento.target.value }))
              }
            />
            <SelectField
              label="Notebook avulso"
              placeholder="Todos os notebooks"
              value={form.notebookId}
              options={notebooks.map((notebook) => ({
                value: notebook.id,
                label: notebook.nome,
              }))}
              onChange={(evento) =>
                setForm((atual) => ({ ...atual, notebookId: evento.target.value }))
              }
              hint={avisoNotebooks ?? undefined}
            />
          </div>

          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium text-slate-700">
              Situação da reserva
            </legend>
            <p className="px-1 pb-2 text-xs text-slate-500">
              Sem nenhuma marcada, a lista traz todas as situações.
            </p>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
              {STATUS_DISPONIVEIS.map(([status, rotulo]) => {
                const marcado = form.status.includes(status);
                return (
                  <label
                    key={status}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={(evento) => alternarStatus(status, evento.target.checked)}
                      className="size-5 shrink-0 rounded border-slate-300 text-senai-700 focus:outline-2 focus:outline-offset-2 focus:outline-senai-600"
                    />
                    {rotulo}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={pendente}>
              Aplicar filtros
            </Button>
            {temFiltro && (
              <Button
                type="button"
                variant="secondary"
                disabled={pendente}
                onClick={() =>
                  navegar({
                    from: "",
                    to: "",
                    status: [],
                    userId: "",
                    kitId: "",
                    notebookId: "",
                    search: "",
                  })
                }
              >
                Limpar filtros
              </Button>
            )}
          </div>

          <p aria-live="polite" className="text-xs text-slate-500">
            {pendente ? "Atualizando a lista..." : ""}
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
