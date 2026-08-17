"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { z } from "zod";
import { api, ApiError } from "@/lib/api-client";
import { bulkCreateNotebooksSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/primitives";
import type { KitStatus } from "@/generated/prisma/enums";

/**
 * Cadastro em lote de notebooks.
 *
 * A prévia é o coração desta tela: ela mostra exatamente quais patrimônios
 * serão gravados ANTES do envio. Sem isso, um prefixo digitado errado só
 * apareceria depois de 50 equipamentos criados — e a correção seria manual, um
 * a um.
 */

export type KitParaLote = {
  id: string;
  code: string;
  name: string;
  status: KitStatus;
  capacity: number;
  notebookCount: number;
};

type DadosDoLote = z.infer<typeof bulkCreateNotebooksSchema>;

type CamposDoLote = {
  prefix: string;
  startNumber: string;
  quantity: string;
  padding: string;
  kitId: string;
  brand: string;
  model: string;
  status: string;
};

const OPCOES_DE_STATUS = [
  { value: "DISPONIVEL", label: "Disponível" },
  { value: "MANUTENCAO", label: "Em manutenção" },
  { value: "INDISPONIVEL", label: "Indisponível" },
];

type ExcessoDeCapacidade = {
  capacidade: number;
  notebooksVinculados: number;
  novosNotebooks: number;
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
    novosNotebooks:
      typeof dados.novosNotebooks === "number" ? dados.novosNotebooks : 0,
  };
}

/** Patrimônios já em uso devolvidos junto do erro de conflito. */
function lerPatrimoniosEmUso(erro: ApiError): string[] {
  const detalhes = erro.details;
  if (typeof detalhes !== "object" || detalhes === null) return [];
  const lista = (detalhes as Record<string, unknown>).patrimoniosEmUso;
  if (!Array.isArray(lista)) return [];
  return lista.filter((item): item is string => typeof item === "string");
}

function camposDoZod(erro: z.ZodError): Record<string, string[]> {
  const campos: Record<string, string[]> = {};
  for (const problema of erro.issues) {
    const chave = problema.path.map(String).join(".") || "_";
    (campos[chave] ??= []).push(problema.message);
  }
  return campos;
}

export function FormularioDeLote({ kits }: { kits: KitParaLote[] }) {
  const router = useRouter();

  const [valores, setValores] = useState<CamposDoLote>({
    prefix: "",
    startNumber: "1",
    quantity: "10",
    padding: "3",
    kitId: "",
    brand: "",
    model: "",
    status: "DISPONIVEL",
  });

  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [colisoes, setColisoes] = useState<string[]>([]);
  const [sucesso, setSucesso] = useState<{
    total: number;
    patrimonios: string[];
  } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pendente, setPendente] = useState<DadosDoLote | null>(null);
  const [excesso, setExcesso] = useState<ExcessoDeCapacidade | null>(null);

  function atualizar(campo: keyof CamposDoLote, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }));
  }

  // A prévia acompanha a digitação: é o retorno que substitui a "conferência
  // depois de gravar".
  const previa = useMemo(() => {
    const prefixo = valores.prefix.trim();
    const inicio = Number(valores.startNumber);
    const quantidade = Number(valores.quantity);
    const zeros = Number(valores.padding);

    if (!prefixo) return null;
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 100) {
      return null;
    }
    if (!Number.isInteger(inicio) || inicio < 0) return null;

    const zerosValidos =
      Number.isInteger(zeros) && zeros >= 0 && zeros <= 6 ? zeros : 0;

    return Array.from(
      { length: quantidade },
      (_, indice) =>
        `${prefixo}${String(inicio + indice).padStart(zerosValidos, "0")}`,
    );
  }, [valores.prefix, valores.startNumber, valores.quantity, valores.padding]);

  const kitEscolhido = kits.find((kit) => kit.id === valores.kitId) ?? null;
  const vagasDoKit = kitEscolhido
    ? Math.max(0, kitEscolhido.capacity - kitEscolhido.notebookCount)
    : null;
  const passaDaCapacidade =
    previa !== null && vagasDoKit !== null && previa.length > vagasDoKit;

  async function enviar(dados: DadosDoLote, confirmarExcesso: boolean) {
    setSalvando(true);
    setErroGeral(null);
    setColisoes([]);

    try {
      const corpo = confirmarExcesso
        ? { ...dados, confirmCapacityOverflow: true }
        : dados;

      const resultado = await api.post<{
        total: number;
        patrimonios: string[];
      }>("/api/notebooks/bulk", corpo);

      setExcesso(null);
      setPendente(null);
      setSucesso({
        total: resultado.total,
        patrimonios: resultado.patrimonios,
      });
      router.refresh();
    } catch (falha) {
      if (falha instanceof ApiError) {
        const conflito = lerExcessoDeCapacidade(falha);
        if (conflito) {
          setPendente(dados);
          setExcesso(conflito);
          return;
        }
        setColisoes(lerPatrimoniosEmUso(falha));
        setErros(falha.fieldErrors);
        setErroGeral(falha.message);
      } else {
        setErroGeral("Não foi possível cadastrar o lote. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  function submeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setSucesso(null);
    setErros({});
    setColisoes([]);

    const resultado = bulkCreateNotebooksSchema.safeParse({
      prefix: valores.prefix,
      startNumber: valores.startNumber,
      quantity: valores.quantity,
      padding: valores.padding,
      kitId: valores.kitId === "" ? null : valores.kitId,
      brand: valores.brand,
      model: valores.model,
      status: valores.status,
    });

    if (!resultado.success) {
      setErros(camposDoZod(resultado.error));
      setErroGeral("Verifique os campos destacados antes de gravar o lote.");
      return;
    }

    void enviar(resultado.data, false);
  }

  return (
    <>
      <form onSubmit={submeter} className="flex flex-col gap-4" noValidate>
        {erroGeral && (
          <Alert tone="danger" title="Nenhum equipamento foi cadastrado">
            <p>{erroGeral}</p>
            {colisoes.length > 0 && (
              <p className="mt-2">
                Patrimônios já em uso:{" "}
                <span className="font-mono">{colisoes.join(", ")}</span>. Ajuste
                o prefixo ou o número inicial e envie de novo.
              </p>
            )}
          </Alert>
        )}

        {sucesso && (
          <Alert
            tone="success"
            title={`${sucesso.total} notebook(s) cadastrado(s)`}
          >
            <p className="font-mono text-xs break-words">
              {sucesso.patrimonios.join(", ")}
            </p>
            <Link
              href={`/admin/notebooks?busca=${encodeURIComponent(valores.prefix.trim())}`}
              className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
            >
              Ver os equipamentos na listagem
            </Link>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            label="Prefixo do patrimônio"
            required
            value={valores.prefix}
            error={erros.prefix}
            hint="Ex.: NB-"
            autoComplete="off"
            maxLength={30}
            onChange={(evento) => atualizar("prefix", evento.target.value)}
          />
          <TextField
            label="Número inicial"
            required
            type="number"
            inputMode="numeric"
            min={0}
            value={valores.startNumber}
            error={erros.startNumber}
            hint="De onde a sequência começa."
            onChange={(evento) => atualizar("startNumber", evento.target.value)}
          />
          <TextField
            label="Quantidade"
            required
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={valores.quantity}
            error={erros.quantity}
            hint="No máximo 100 por lote."
            onChange={(evento) => atualizar("quantity", evento.target.value)}
          />
          <TextField
            label="Zeros à esquerda"
            required
            type="number"
            inputMode="numeric"
            min={0}
            max={6}
            value={valores.padding}
            error={erros.padding}
            hint="3 gera 001, 002, 003…"
            onChange={(evento) => atualizar("padding", evento.target.value)}
          />
        </div>

        {/* Região viva: o leitor de tela anuncia a faixa recalculada sem que o
            usuário precise procurar a informação. */}
        <div
          aria-live="polite"
          className="rounded-lg border border-slate-200 bg-slate-50 p-4"
        >
          <h3 className="text-sm font-semibold text-slate-800">
            Prévia dos patrimônios
          </h3>
          {previa === null ? (
            <p className="mt-1 text-sm text-slate-600">
              Preencha prefixo, número inicial e quantidade para ver exatamente
              o que será gerado.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-700">
                Serão criados <strong>{previa.length}</strong> equipamento(s):{" "}
                <span className="font-mono">{previa[0]}</span> …{" "}
                <span className="font-mono">{previa[previa.length - 1]}</span>
              </p>
              <ul className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {previa.map((patrimonio) => (
                  <li
                    key={patrimonio}
                    className="rounded bg-white px-2 py-1 font-mono text-xs text-slate-700 ring-1 ring-slate-200 ring-inset"
                  >
                    {patrimonio}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Kit de destino"
            value={valores.kitId}
            error={erros.kitId}
            placeholder="Avulsos (sem kit)"
            options={kits.map((kit) => ({
              value: kit.id,
              label:
                kit.status === "DESATIVADO"
                  ? `${kit.name} (${kit.code}) — desativado`
                  : `${kit.name} (${kit.code}) — ${Math.max(0, kit.capacity - kit.notebookCount)} vaga(s)`,
              disabled: kit.status === "DESATIVADO",
            }))}
            hint={
              vagasDoKit === null
                ? "Os equipamentos podem ficar avulsos e ser vinculados depois."
                : `${vagasDoKit} vaga(s) livre(s) neste kit.`
            }
            onChange={(evento) => atualizar("kitId", evento.target.value)}
          />
          <TextField
            label="Marca"
            value={valores.brand}
            error={erros.brand}
            autoComplete="off"
            maxLength={60}
            onChange={(evento) => atualizar("brand", evento.target.value)}
          />
          <TextField
            label="Modelo"
            value={valores.model}
            error={erros.model}
            autoComplete="off"
            maxLength={60}
            onChange={(evento) => atualizar("model", evento.target.value)}
          />
          <SelectField
            label="Status inicial"
            value={valores.status}
            error={erros.status}
            options={OPCOES_DE_STATUS}
            onChange={(evento) => atualizar("status", evento.target.value)}
          />
        </div>

        {passaDaCapacidade && kitEscolhido && (
          <Alert tone="warning" title="O lote passa da capacidade do kit">
            O kit {kitEscolhido.name} tem {vagasDoKit} vaga(s) livre(s) e você
            está gerando {previa?.length} equipamento(s). Ao enviar, o sistema
            vai pedir confirmação — ou escolha outro destino.
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={salvando} disabled={previa === null}>
            Cadastrar {previa ? `${previa.length} notebook(s)` : "lote"}
          </Button>
          <Link
            href="/admin/notebooks"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-100 px-4 text-sm font-medium text-slate-800 hover:bg-slate-200"
          >
            Cancelar
          </Link>
        </div>
      </form>

      <ConfirmDialog
        open={excesso !== null}
        title="O lote ultrapassa a capacidade do kit"
        confirmLabel="Cadastrar mesmo assim"
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
                O kit comporta <strong>{excesso.capacidade}</strong> notebook(s),
                já tem <strong>{excesso.notebooksVinculados}</strong> e este lote
                acrescenta <strong>{excesso.novosNotebooks}</strong>.
              </p>
              <p className="mt-2">
                Confirmando, o kit fica acima do planejado e a exceção é
                registrada no histórico com o seu nome.
              </p>
            </>
          )
        }
      />
    </>
  );
}
