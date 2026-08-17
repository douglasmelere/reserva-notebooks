"use client";

import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/primitives";

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

  const assinatura = Object.values(valores).join("|");

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);

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
