"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";

/**
 * Filtros da listagem de usuários.
 *
 * Escrevem na URL em vez de guardar estado local: a página é um Server
 * Component e é a própria navegação que refaz a consulta no banco. Assim o
 * botão "voltar" do navegador desfaz o filtro, como a pessoa espera.
 */
export function FiltrosUsuarios({
  busca,
  perfil,
  situacao,
}: {
  busca: string;
  perfil: string;
  situacao: string;
}) {
  const router = useRouter();

  const [valorBusca, setValorBusca] = useState(busca);
  const [valorPerfil, setValorPerfil] = useState(perfil);
  const [valorSituacao, setValorSituacao] = useState(situacao);

  // `useTransition` amarra o estado de carregamento à navegação em si. Um
  // booleano nosso ficaria preso em "aplicando" quando a pessoa reenviasse os
  // mesmos filtros: a URL não mudaria, as props não mudariam, e o botão
  // continuaria girando para sempre.
  const [navegando, iniciarNavegacao] = useTransition();
  const [acao, setAcao] = useState<"aplicar" | "limpar" | null>(null);

  // Ressincroniza quando a URL muda por fora (voltar, link de paginação).
  useEffect(() => {
    setValorBusca(busca);
    setValorPerfil(perfil);
    setValorSituacao(situacao);
  }, [busca, perfil, situacao]);

  useEffect(() => {
    if (!navegando) setAcao(null);
  }, [navegando]);

  function aplicar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAcao("aplicar");

    const search = new URLSearchParams();
    if (valorBusca.trim()) search.set("busca", valorBusca.trim());
    if (valorPerfil) search.set("perfil", valorPerfil);
    if (valorSituacao) search.set("situacao", valorSituacao);
    // Trocar de filtro sempre volta para a primeira página: manter "página 4"
    // com um resultado novo costuma levar a uma lista vazia sem explicação.
    const qs = search.toString();
    iniciarNavegacao(() => {
      router.push(`/admin/usuarios${qs ? `?${qs}` : ""}`);
    });
  }

  function limpar() {
    setAcao("limpar");
    setValorBusca("");
    setValorPerfil("");
    setValorSituacao("");
    iniciarNavegacao(() => {
      router.push("/admin/usuarios");
    });
  }

  const temFiltro = Boolean(busca || perfil || situacao);

  return (
    <form onSubmit={aplicar} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="Buscar"
          type="search"
          name="busca"
          placeholder="Nome, usuário, e-mail ou departamento"
          value={valorBusca}
          onChange={(event) => setValorBusca(event.target.value)}
        />

        <SelectField
          label="Perfil de acesso"
          name="perfil"
          value={valorPerfil}
          onChange={(event) => setValorPerfil(event.target.value)}
          options={[
            { value: "", label: "Todos os perfis" },
            { value: "PROFESSOR", label: "Professor(a)" },
            { value: "SUPERVISOR", label: "Supervisão" },
          ]}
        />

        <SelectField
          label="Situação da conta"
          name="situacao"
          value={valorSituacao}
          onChange={(event) => setValorSituacao(event.target.value)}
          options={[
            { value: "", label: "Ativas e desativadas" },
            { value: "ativos", label: "Somente ativas" },
            { value: "inativos", label: "Somente desativadas" },
          ]}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          loading={navegando && acao === "aplicar"}
          disabled={navegando && acao === "limpar"}
        >
          Aplicar filtros
        </Button>
        {temFiltro && (
          <Button
            type="button"
            variant="secondary"
            onClick={limpar}
            loading={navegando && acao === "limpar"}
            disabled={navegando && acao === "aplicar"}
          >
            Limpar
          </Button>
        )}
      </div>
    </form>
  );
}
