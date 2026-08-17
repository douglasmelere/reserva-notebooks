"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { queryString } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/primitives";

/**
 * Filtros da consulta de disponibilidade.
 *
 * Tudo vai para a URL em vez de ficar em estado local: assim a tela é
 * compartilhável por link ("veja a quarta-feira de manhã"), sobrevive ao
 * recarregar e ao botão voltar do navegador, e a leitura continua sendo feita
 * pelo Server Component — que é quem sabe consultar o banco.
 */

export type VisaoDisponibilidade = "dia" | "semana" | "mes";

export type FiltrosValores = {
  date: string;
  startTime: string;
  endTime: string;
  kitType: string;
  location: string;
  minCapacity: string;
  search: string;
  view: VisaoDisponibilidade;
};

const VISOES: { valor: VisaoDisponibilidade; rotulo: string }[] = [
  { valor: "dia", rotulo: "Dia" },
  { valor: "semana", rotulo: "Semana" },
  { valor: "mes", rotulo: "Mês" },
];

export function Filtros({ valores }: { valores: FiltrosValores }) {
  const router = useRouter();
  const [pendente, iniciarTransicao] = useTransition();
  const [form, setForm] = useState<FiltrosValores>(valores);
  const [erroHorario, setErroHorario] = useState<string | null>(null);
  // Qual botão disparou a navegação: os dois usam a mesma transição, mas
  // girar os dois ao mesmo tempo não diria qual ação está em andamento.
  const [acao, setAcao] = useState<"aplicar" | "limpar" | null>(null);

  function navegar(proximo: FiltrosValores, origem: "aplicar" | "limpar") {
    setAcao(origem);
    const url = `/disponibilidade${queryString({
      date: proximo.date,
      startTime: proximo.startTime,
      endTime: proximo.endTime,
      kitType: proximo.kitType,
      location: proximo.location,
      minCapacity: proximo.minCapacity,
      search: proximo.search,
      view: proximo.view,
    })}`;
    // Dentro da transição, o botão mostra carregamento enquanto o servidor
    // recalcula a disponibilidade.
    iniciarTransicao(() => router.push(url));
  }

  function aplicar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // O servidor recusa fim <= início. Barrar aqui evita a ida ao servidor e
    // aponta o campo errado, em vez de devolver a tela com um aviso solto.
    if (form.startTime && form.endTime && form.endTime <= form.startTime) {
      setErroHorario(
        "O horário final deve ser depois do inicial. Ajuste o campo “Às” ou apague os dois para consultar o dia inteiro.",
      );
      return;
    }

    setErroHorario(null);
    navegar(form, "aplicar");
  }

  function trocarVisao(view: VisaoDisponibilidade) {
    const proximo = { ...form, view };
    setForm(proximo);
    navegar(proximo, "aplicar");
  }

  function limpar() {
    const proximo: FiltrosValores = {
      date: form.date,
      startTime: "",
      endTime: "",
      kitType: "",
      location: "",
      minCapacity: "",
      search: "",
      view: form.view,
    };
    setErroHorario(null);
    setForm(proximo);
    navegar(proximo, "limpar");
  }

  const atualizar = <K extends keyof FiltrosValores>(
    campo: K,
    valor: FiltrosValores[K],
  ) => {
    // Mexeu no horário, o aviso antigo já não descreve o que está na tela.
    if (campo === "startTime" || campo === "endTime") setErroHorario(null);
    setForm((atual) => ({ ...atual, [campo]: valor }));
  };

  return (
    <Card className="mb-4">
      <CardBody>
        <div
          role="group"
          aria-label="Forma de visualização"
          className="flex flex-wrap gap-2"
        >
          {VISOES.map((visao) => {
            const ativa = form.view === visao.valor;
            return (
              <button
                key={visao.valor}
                type="button"
                aria-pressed={ativa}
                onClick={() => trocarVisao(visao.valor)}
                className={cn(
                  "min-h-11 rounded-lg px-4 text-sm font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700",
                  ativa
                    ? "bg-sky-700 text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {visao.rotulo}
              </button>
            );
          })}
        </div>

        <form onSubmit={aplicar} className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              label="Data"
              type="date"
              value={form.date}
              required
              onChange={(e) => atualizar("date", e.target.value)}
              hint={
                form.view === "dia"
                  ? "Dia consultado"
                  : "O calendário mostra o período que contém esta data"
              }
            />

            <TextField
              label="Das"
              type="time"
              value={form.startTime}
              onChange={(e) => atualizar("startTime", e.target.value)}
              hint="Deixe em branco para o dia inteiro"
            />

            <TextField
              label="Às"
              type="time"
              value={form.endTime}
              error={erroHorario}
              onChange={(e) => atualizar("endTime", e.target.value)}
              hint="Deixe em branco para o dia inteiro"
            />

            <SelectField
              label="Tipo de kit"
              value={form.kitType}
              placeholder="Maletas e carrinhos"
              options={[
                { value: "MALETA", label: "Somente maletas" },
                { value: "CARRINHO", label: "Somente carrinhos" },
              ]}
              onChange={(e) => atualizar("kitType", e.target.value)}
            />

            <TextField
              label="Localização"
              type="text"
              value={form.location}
              placeholder="Ex.: Bloco B"
              onChange={(e) => atualizar("location", e.target.value)}
            />

            <TextField
              label="Capacidade mínima"
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              value={form.minCapacity}
              placeholder="Ex.: 20"
              onChange={(e) => atualizar("minCapacity", e.target.value)}
              hint="Quantidade de notebooks que o kit comporta"
            />

            <TextField
              label="Buscar por nome, código ou patrimônio"
              type="search"
              value={form.search}
              placeholder="Ex.: maleta 2 ou NB-014"
              onChange={(e) => atualizar("search", e.target.value)}
              className="sm:col-span-2 lg:col-span-3"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" loading={pendente && acao === "aplicar"}>
              Aplicar filtros
            </Button>
            <Button
              type="button"
              variant="ghost"
              loading={pendente && acao === "limpar"}
              onClick={limpar}
            >
              Limpar filtros
            </Button>
          </div>
        </form>

        {/* A lista abaixo troca sozinha quando a navegação termina; sem este
            aviso, quem usa leitor de tela não perceberia a atualização. O
            `acao` segura a mensagem final: sem ele, a região anunciaria algo
            já na primeira renderização, antes de qualquer filtro. */}
        <p aria-live="polite" className="mt-2 text-xs text-slate-600">
          {pendente
            ? "Atualizando a disponibilidade..."
            : acao
              ? "Disponibilidade atualizada com os filtros escolhidos."
              : ""}
        </p>
      </CardBody>
    </Card>
  );
}
