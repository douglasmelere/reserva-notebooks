"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";

/**
 * Filtros da listagem de kits.
 *
 * Os valores viajam na URL, e não em estado do React: assim a supervisão pode
 * guardar o link de "carrinhos em manutenção", recarregar a página sem perder o
 * recorte e voltar pelo histórico do navegador.
 *
 * Os rótulos de status são declarados aqui, e não importados de
 * `@/server/resources`: aquele módulo depende de `node:crypto` e do Prisma, que
 * não podem entrar no pacote do navegador.
 */

const OPCOES_DE_TIPO = [
  { value: "MALETA", label: "Maleta" },
  { value: "CARRINHO", label: "Carrinho" },
];

const OPCOES_DE_STATUS = [
  { value: "DISPONIVEL", label: "Disponível" },
  { value: "MANUTENCAO", label: "Em manutenção" },
  { value: "INDISPONIVEL", label: "Indisponível" },
  { value: "DESATIVADO", label: "Desativado" },
];

export function FiltrosDeKits({
  tipo,
  status,
  local,
  busca,
  incluirDesativados,
}: {
  tipo: string;
  status: string;
  local: string;
  busca: string;
  incluirDesativados: boolean;
}) {
  const router = useRouter();
  const [valores, setValores] = useState({
    tipo,
    status,
    local,
    busca,
    desativados: incluirDesativados,
  });

  function aplicar() {
    const params = new URLSearchParams();
    if (valores.tipo) params.set("tipo", valores.tipo);
    if (valores.status) params.set("status", valores.status);
    if (valores.local.trim()) params.set("local", valores.local.trim());
    if (valores.busca.trim()) params.set("busca", valores.busca.trim());
    // Pedir o status "Desativado" sem incluir os desativados devolveria lista
    // vazia — o servidor filtra esse status para quem não pediu. Ligamos a
    // inclusão junto para que o filtro faça o que a pessoa quis dizer.
    if (valores.desativados || valores.status === "DESATIVADO") {
      params.set("desativados", "1");
    }
    // Sem "pagina": trocar de filtro sempre recomeça na primeira página.
    const query = params.toString();
    router.push(query ? `/admin/kits?${query}` : "/admin/kits");
  }

  function limpar() {
    setValores({
      tipo: "",
      status: "",
      local: "",
      busca: "",
      desativados: false,
    });
    router.push("/admin/kits");
  }

  return (
    <Card>
      <CardHeader
        title="Filtros"
        description="Combine tipo, status, localização e busca por código ou nome."
      />
      <CardBody>
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            aplicar();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label="Tipo"
              value={valores.tipo}
              placeholder="Todos os tipos"
              options={OPCOES_DE_TIPO}
              onChange={(evento) =>
                setValores((v) => ({ ...v, tipo: evento.target.value }))
              }
            />
            <SelectField
              label="Status"
              value={valores.status}
              placeholder="Todos os status"
              options={OPCOES_DE_STATUS}
              onChange={(evento) =>
                setValores((v) => ({ ...v, status: evento.target.value }))
              }
            />
            <TextField
              label="Localização"
              value={valores.local}
              placeholder="Ex.: Bloco B"
              autoComplete="off"
              onChange={(evento) =>
                setValores((v) => ({ ...v, local: evento.target.value }))
              }
            />
            <TextField
              label="Buscar"
              type="search"
              value={valores.busca}
              placeholder="Código ou nome do kit"
              autoComplete="off"
              onChange={(evento) =>
                setValores((v) => ({ ...v, busca: evento.target.value }))
              }
            />
          </div>

          <CheckboxField
            label="Incluir kits desativados"
            hint="Desativado é baixa lógica: o kit sai da disponibilidade, mas o histórico continua."
            checked={valores.desativados}
            onChange={(evento) =>
              setValores((v) => ({ ...v, desativados: evento.target.checked }))
            }
          />

          <div className="flex flex-wrap gap-2">
            <Button type="submit">Aplicar filtros</Button>
            <Button type="button" variant="ghost" onClick={limpar}>
              Limpar
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
