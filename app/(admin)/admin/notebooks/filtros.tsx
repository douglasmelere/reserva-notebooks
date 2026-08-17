"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";

/**
 * Filtros da listagem de notebooks.
 *
 * Os valores ficam na URL para que o recorte possa ser compartilhado e
 * recarregado. Os rótulos de status são declarados aqui porque
 * `@/server/resources` depende de `node:crypto` e não pode ir para o navegador.
 */

const OPCOES_DE_STATUS = [
  { value: "DISPONIVEL", label: "Disponível" },
  { value: "RESERVADO", label: "Reservado" },
  { value: "EM_USO", label: "Em uso" },
  { value: "MANUTENCAO", label: "Em manutenção" },
  { value: "PERDIDO", label: "Perdido" },
  { value: "INDISPONIVEL", label: "Indisponível" },
  { value: "DESATIVADO", label: "Desativado" },
];

export type KitParaFiltro = { id: string; code: string; name: string };

export function FiltrosDeNotebooks({
  status,
  kitId,
  avulsos,
  busca,
  kits,
}: {
  status: string;
  kitId: string;
  avulsos: boolean;
  busca: string;
  kits: KitParaFiltro[];
}) {
  const router = useRouter();
  const [valores, setValores] = useState({ status, kitId, avulsos, busca });

  function aplicar() {
    const params = new URLSearchParams();
    if (valores.status) params.set("status", valores.status);
    // "Somente avulsos" e "kit" são mutuamente exclusivos: o serviço ignora o
    // kit quando o avulso está ligado, e mandar os dois faria a tela mostrar um
    // filtro que não está valendo.
    if (valores.avulsos) {
      params.set("avulsos", "1");
    } else if (valores.kitId) {
      params.set("kit", valores.kitId);
    }
    if (valores.busca.trim()) params.set("busca", valores.busca.trim());

    const query = params.toString();
    router.push(query ? `/admin/notebooks?${query}` : "/admin/notebooks");
  }

  function limpar() {
    setValores({ status: "", kitId: "", avulsos: false, busca: "" });
    router.push("/admin/notebooks");
  }

  return (
    <Card>
      <CardHeader
        title="Filtros"
        description="A busca procura por patrimônio, número de série e apelido."
      />
      <CardBody>
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            aplicar();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label="Status"
              value={valores.status}
              placeholder="Todos os status"
              options={OPCOES_DE_STATUS}
              onChange={(evento) =>
                setValores((v) => ({ ...v, status: evento.target.value }))
              }
            />
            <SelectField
              label="Kit"
              value={valores.kitId}
              placeholder="Todos os kits"
              disabled={valores.avulsos}
              hint={
                valores.avulsos
                  ? "Desmarque “somente avulsos” para filtrar por kit."
                  : undefined
              }
              options={kits.map((kit) => ({
                value: kit.id,
                label: `${kit.name} (${kit.code})`,
              }))}
              onChange={(evento) =>
                setValores((v) => ({ ...v, kitId: evento.target.value }))
              }
            />
            <TextField
              label="Buscar"
              type="search"
              value={valores.busca}
              placeholder="Patrimônio, série ou apelido"
              autoComplete="off"
              onChange={(evento) =>
                setValores((v) => ({ ...v, busca: evento.target.value }))
              }
            />
          </div>

          <CheckboxField
            label="Somente avulsos (sem kit)"
            hint="Equipamentos que não pertencem a nenhuma maleta ou carrinho."
            checked={valores.avulsos}
            onChange={(evento) =>
              setValores((v) => ({
                ...v,
                avulsos: evento.target.checked,
                kitId: evento.target.checked ? "" : v.kitId,
              }))
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
