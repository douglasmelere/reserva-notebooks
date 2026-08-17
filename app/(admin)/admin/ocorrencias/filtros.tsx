"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Alert, Card, CardBody } from "@/components/ui/primitives";

type Opcao = { value: string; label: string };

export type ValoresFiltro = {
  status: string;
  severidade: string;
  categoria: string;
  alvo: string;
  de: string;
  ate: string;
  busca: string;
};

/**
 * Filtros da fila de ocorrências.
 *
 * Todos os campos são aplicados de uma vez, no botão "Filtrar": a supervisão
 * costuma montar o recorte inteiro (status + severidade + período) antes de
 * querer o resultado, e recarregar a lista a cada campo alterado só atrapalha.
 *
 * Os campos são não controlados e recebem `key` derivada dos valores atuais —
 * assim o formulário volta ao estado da URL quando o usuário usa voltar/avançar
 * do navegador, sem um efeito de sincronização.
 */
export function FiltrosOcorrencias({
  valores,
  statusOpcoes,
  severidadeOpcoes,
  categoriaOpcoes,
  alvoOpcoes,
}: {
  valores: ValoresFiltro;
  statusOpcoes: Opcao[];
  severidadeOpcoes: Opcao[];
  categoriaOpcoes: Opcao[];
  alvoOpcoes: Opcao[];
}) {
  const router = useRouter();
  const [aplicando, iniciarTransicao] = useTransition();
  const [erroPeriodo, setErroPeriodo] = useState<string | null>(null);

  const assinatura = Object.values(valores).join("|");

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);

    // Período invertido devolvia uma lista vazia com a mensagem genérica de
    // "nenhuma ocorrência com esses filtros" — que não conta qual é o erro.
    const de = String(dados.get("de") ?? "");
    const ate = String(dados.get("ate") ?? "");
    if (de && ate && de > ate) {
      setErroPeriodo("Esta data é anterior à data inicial.");
      return;
    }
    setErroPeriodo(null);

    const params = new URLSearchParams();
    for (const campo of [
      "status",
      "severidade",
      "categoria",
      "alvo",
      "de",
      "ate",
      "busca",
    ] as const) {
      const valor = String(dados.get(campo) ?? "").trim();
      if (valor) params.set(campo, valor);
    }

    // Trocar o recorte reinicia a paginação: continuar na página 7 de um
    // resultado que agora tem duas páginas mostraria uma lista vazia.
    const qs = params.toString();
    iniciarTransicao(() => {
      router.push(`/admin/ocorrencias${qs ? `?${qs}` : ""}`);
    });
  }

  function limpar() {
    setErroPeriodo(null);
    iniciarTransicao(() => {
      router.push("/admin/ocorrencias");
    });
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Filtros</h2>
        <form onSubmit={aplicar} key={assinatura}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label="Situação"
              name="status"
              defaultValue={valores.status}
              options={statusOpcoes}
              placeholder="Todas as situações"
            />
            <SelectField
              label="Severidade"
              name="severidade"
              defaultValue={valores.severidade}
              options={severidadeOpcoes}
              placeholder="Todas as severidades"
            />
            <SelectField
              label="Categoria"
              name="categoria"
              defaultValue={valores.categoria}
              options={categoriaOpcoes}
              placeholder="Todas as categorias"
            />
            <SelectField
              label="Tipo de alvo"
              name="alvo"
              defaultValue={valores.alvo}
              options={alvoOpcoes}
              placeholder="Todos os tipos"
            />
            <TextField
              label="Aberta a partir de"
              name="de"
              type="date"
              defaultValue={valores.de}
            />
            <TextField
              label="Aberta até"
              name="ate"
              type="date"
              defaultValue={valores.ate}
              error={erroPeriodo}
            />
            <TextField
              label="Buscar"
              name="busca"
              type="search"
              defaultValue={valores.busca}
              placeholder="Código, patrimônio, descrição..."
              className="sm:col-span-2"
              hint="Procura no código da ocorrência, na descrição, na solução e no equipamento."
            />
          </div>

          {/* O erro fica marcado no campo, mas nada mudaria na tela para quem
              usa leitor: o `Alert` carrega role="alert" e conta que o clique em
              "Filtrar" não aplicou nada. */}
          {erroPeriodo && (
            <Alert tone="danger" className="mt-4">
              Nenhum filtro foi aplicado: a data final é anterior à data inicial.
            </Alert>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" loading={aplicando}>
              Filtrar
            </Button>
            <Button type="button" variant="outline" onClick={limpar} disabled={aplicando}>
              Limpar filtros
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
