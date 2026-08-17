"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { api, ApiError } from "@/lib/api-client";
import { createKitSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/primitives";
import type { KitStatus, KitType } from "@/generated/prisma/enums";

/**
 * Formulário de cadastro e edição de kit — o mesmo nos dois casos, porque os
 * campos são idênticos e manter duas cópias garantiria que uma delas ficasse
 * defasada.
 *
 * A validação usa o MESMO esquema Zod da API (`createKitSchema`): o formulário
 * dá o retorno imediato, a rota valida de novo ao receber.
 */

export type KitParaEdicao = {
  id: string;
  code: string;
  name: string;
  type: KitType;
  capacity: number;
  location: string | null;
  description: string | null;
  notes: string | null;
  status: KitStatus;
};

type DadosDoKit = z.infer<typeof createKitSchema>;

/** Estado do formulário: tudo texto, como o usuário digitou. */
type CamposDoKit = {
  code: string;
  name: string;
  type: string;
  capacity: string;
  location: string;
  description: string;
  notes: string;
  status: string;
};

const OPCOES_DE_TIPO = [
  { value: "MALETA", label: "Maleta" },
  { value: "CARRINHO", label: "Carrinho" },
];

/**
 * Desativar não fica no seletor de status: é ação destrutiva e passa por
 * confirmação própria, no painel de gestão. A opção só aparece aqui quando o
 * kit JÁ está desativado, para que o seletor consiga exibir o valor atual.
 */
const OPCOES_DE_STATUS = [
  { value: "DISPONIVEL", label: "Disponível" },
  { value: "MANUTENCAO", label: "Em manutenção" },
  { value: "INDISPONIVEL", label: "Indisponível" },
];

/** Excesso de capacidade relatado pela API em `REGRA_DE_NEGOCIO`. */
type ExcessoDeCapacidade = {
  capacidade: number;
  notebooksVinculados: number;
};

function lerExcessoDeCapacidade(erro: ApiError): ExcessoDeCapacidade | null {
  if (erro.code !== "REGRA_DE_NEGOCIO") return null;
  const detalhes = erro.details;
  if (typeof detalhes !== "object" || detalhes === null) return null;

  const dados = detalhes as Record<string, unknown>;
  if (dados.campoConfirmacao !== "confirmCapacityOverflow") return null;
  if (
    typeof dados.capacidade !== "number" ||
    typeof dados.notebooksVinculados !== "number"
  ) {
    return null;
  }

  return {
    capacidade: dados.capacidade,
    notebooksVinculados: dados.notebooksVinculados,
  };
}

function camposDoZod(erro: z.ZodError): Record<string, string[]> {
  const campos: Record<string, string[]> = {};
  for (const problema of erro.issues) {
    const chave = problema.path.map(String).join(".") || "_";
    (campos[chave] ??= []).push(problema.message);
  }
  return campos;
}

export function KitForm({
  kit,
  onSaved,
  onCancel,
}: {
  /** Ausente = cadastro novo. */
  kit?: KitParaEdicao;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const editando = kit !== undefined;

  // Todos os campos são texto no formulário; quem converte para número e para
  // os enums é o esquema Zod, o mesmo que a API usa.
  const [valores, setValores] = useState<CamposDoKit>({
    code: kit?.code ?? "",
    name: kit?.name ?? "",
    type: kit?.type ?? "MALETA",
    capacity: kit ? String(kit.capacity) : "",
    location: kit?.location ?? "",
    description: kit?.description ?? "",
    notes: kit?.notes ?? "",
    status: kit?.status ?? "DISPONIVEL",
  });

  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Guardados juntos: a confirmação só faz sentido com os dados que a
  // motivaram, e reenviar outra coisa seria confirmar algo que não foi lido.
  const [pendente, setPendente] = useState<DadosDoKit | null>(null);
  const [excesso, setExcesso] = useState<ExcessoDeCapacidade | null>(null);

  const opcoesDeStatus =
    kit?.status === "DESATIVADO"
      ? [...OPCOES_DE_STATUS, { value: "DESATIVADO", label: "Desativado" }]
      : OPCOES_DE_STATUS;

  function atualizar(campo: keyof CamposDoKit, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }));
  }

  async function enviar(dados: DadosDoKit, confirmarExcesso: boolean) {
    setSalvando(true);
    setErroGeral(null);

    try {
      const corpo = confirmarExcesso
        ? { ...dados, confirmCapacityOverflow: true }
        : dados;

      if (editando) {
        await api.patch(`/api/kits/${kit.id}`, corpo);
        setSucesso("Kit atualizado com sucesso.");
        setPendente(null);
        setExcesso(null);
        // Recarrega os Server Components: cabeçalho, badges e histórico da
        // tela de detalhe passam a refletir o que acabou de ser gravado.
        router.refresh();
        onSaved?.();
      } else {
        const criado = await api.post<{ kit: { id: string } }>(
          "/api/kits",
          corpo,
        );
        router.push(`/admin/kits/${criado.kit.id}`);
        router.refresh();
      }
    } catch (erro) {
      if (erro instanceof ApiError) {
        const conflito = lerExcessoDeCapacidade(erro);
        if (conflito) {
          setPendente(dados);
          setExcesso(conflito);
          return;
        }
        setErros(erro.fieldErrors);
        setErroGeral(erro.message);
      } else {
        setErroGeral("Não foi possível salvar o kit. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  function submeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setSucesso(null);
    setErros({});

    const resultado = createKitSchema.safeParse({
      code: valores.code,
      name: valores.name,
      type: valores.type,
      capacity: valores.capacity,
      location: valores.location,
      description: valores.description,
      notes: valores.notes,
      status: valores.status,
    });

    if (!resultado.success) {
      setErros(camposDoZod(resultado.error));
      setErroGeral("Verifique os campos destacados antes de salvar.");
      return;
    }

    void enviar(resultado.data, false);
  }

  return (
    <>
      <form onSubmit={submeter} className="flex flex-col gap-4" noValidate>
        {erroGeral && (
          <Alert tone="danger" title="Não foi possível salvar">
            {erroGeral}
          </Alert>
        )}
        {sucesso && <Alert tone="success">{sucesso}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Código / patrimônio"
            required
            value={valores.code}
            error={erros.code}
            hint="Identificador único do kit. Ex.: MAL-01"
            autoComplete="off"
            maxLength={40}
            onChange={(evento) => atualizar("code", evento.target.value)}
          />
          <TextField
            label="Nome"
            required
            value={valores.name}
            error={erros.name}
            hint="Como a supervisão e os professores chamam este kit."
            autoComplete="off"
            maxLength={80}
            onChange={(evento) => atualizar("name", evento.target.value)}
          />
          <SelectField
            label="Tipo"
            required
            value={valores.type}
            error={erros.type}
            options={OPCOES_DE_TIPO}
            onChange={(evento) => atualizar("type", evento.target.value)}
          />
          <TextField
            label="Capacidade"
            required
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            value={valores.capacity}
            error={erros.capacity}
            hint="Quantos notebooks o kit comporta. Reduzir abaixo do que já está vinculado exige confirmação."
            onChange={(evento) => atualizar("capacity", evento.target.value)}
          />
          <TextField
            label="Localização"
            value={valores.location}
            error={erros.location}
            hint="Onde o kit fica guardado. Ex.: Sala dos professores."
            autoComplete="off"
            maxLength={120}
            onChange={(evento) => atualizar("location", evento.target.value)}
          />
          <SelectField
            label="Status"
            value={valores.status}
            error={erros.status}
            options={opcoesDeStatus}
            hint="Para tirar o kit do inventário use o botão “Desativar kit”, que preserva o histórico."
            onChange={(evento) => atualizar("status", evento.target.value)}
          />
        </div>

        <TextAreaField
          label="Descrição"
          value={valores.description}
          error={erros.description}
          hint="O que há dentro do kit: modelos, acessórios, particularidades."
          maxLength={500}
          onChange={(evento) => atualizar("description", evento.target.value)}
        />

        <TextAreaField
          label="Observações internas"
          value={valores.notes}
          error={erros.notes}
          hint="Visível apenas para a supervisão."
          maxLength={500}
          onChange={(evento) => atualizar("notes", evento.target.value)}
        />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={salvando}>
            {editando ? "Salvar alterações" : "Cadastrar kit"}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={salvando}
            >
              Cancelar
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={excesso !== null}
        title="Capacidade menor que os notebooks vinculados"
        confirmLabel="Confirmar mesmo assim"
        cancelLabel="Voltar e ajustar"
        confirmVariant="danger"
        loading={salvando}
        onConfirm={() => {
          if (pendente) void enviar(pendente, true);
        }}
        onCancel={() => {
          setExcesso(null);
          setPendente(null);
        }}
        description={
          excesso && (
            <>
              <p>
                Este kit tem <strong>{excesso.notebooksVinculados}</strong>{" "}
                notebook(s) vinculado(s) e você informou capacidade{" "}
                <strong>{excesso.capacidade}</strong>.
              </p>
              <p className="mt-2">
                Confirmando, o kit fica registrado acima do planejado e a
                exceção vai para o histórico com o seu nome. Se preferir,
                cancele e transfira os notebooks excedentes para outro kit
                antes.
              </p>
            </>
          )
        }
      />
    </>
  );
}
