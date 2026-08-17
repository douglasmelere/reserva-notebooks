"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { api, ApiError } from "@/lib/api-client";
import { createNotebookSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { useDisclosureFocus } from "@/components/ui/use-disclosure-focus";
import type { KitStatus, NotebookStatus } from "@/generated/prisma/enums";

/**
 * Interatividade do inventário de notebooks.
 *
 * Estão no mesmo módulo o formulário (cadastro e edição) e o painel de gestão
 * do detalhe (status, transferência e desativação) porque os três compartilham
 * o mesmo tratamento de erro da API: confirmação de excesso de capacidade e
 * aviso de reservas futuras impactadas.
 *
 * Regra que atravessa tudo: mudar o status NUNCA cancela reserva. A API devolve
 * quantas reservas ativas dependem do equipamento e a tela mostra esse número —
 * quem avisa os professores é a supervisão.
 */

export type KitParaSelecao = {
  id: string;
  code: string;
  name: string;
  status: KitStatus;
};

export type NotebookParaEdicao = {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  nickname: string | null;
  brand: string | null;
  model: string | null;
  kitId: string | null;
  status: NotebookStatus;
  notes: string | null;
};

type DadosDoNotebook = z.infer<typeof createNotebookSchema>;

type CamposDoNotebook = {
  assetTag: string;
  serialNumber: string;
  nickname: string;
  brand: string;
  model: string;
  kitId: string;
  status: string;
  notes: string;
};

/** Resposta das mutações de notebook (PATCH e DELETE). */
type ResultadoDaMutacao = {
  notebook: { id: string; assetTag: string; statusLabel: string };
  reservasFuturasAtivas: number;
  aviso: string | null;
};

const OPCOES_DE_STATUS = [
  { value: "DISPONIVEL", label: "Disponível" },
  { value: "RESERVADO", label: "Reservado" },
  { value: "EM_USO", label: "Em uso" },
  { value: "MANUTENCAO", label: "Em manutenção" },
  { value: "PERDIDO", label: "Perdido" },
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
      typeof dados.novosNotebooks === "number" ? dados.novosNotebooks : 1,
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

/** Opções de kit; kits desativados aparecem, mas não podem receber equipamento. */
function opcoesDeKit(kits: KitParaSelecao[]) {
  return kits.map((kit) => ({
    value: kit.id,
    label:
      kit.status === "DESATIVADO"
        ? `${kit.name} (${kit.code}) — desativado`
        : `${kit.name} (${kit.code})`,
    disabled: kit.status === "DESATIVADO",
  }));
}

// ---------------------------------------------------------------------------
// Formulário de cadastro / edição
// ---------------------------------------------------------------------------

export function NotebookForm({
  notebook,
  kits,
  onSaved,
  onCancel,
}: {
  /** Ausente = cadastro novo. */
  notebook?: NotebookParaEdicao;
  kits: KitParaSelecao[];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const editando = notebook !== undefined;

  const [valores, setValores] = useState<CamposDoNotebook>({
    assetTag: notebook?.assetTag ?? "",
    serialNumber: notebook?.serialNumber ?? "",
    nickname: notebook?.nickname ?? "",
    brand: notebook?.brand ?? "",
    model: notebook?.model ?? "",
    kitId: notebook?.kitId ?? "",
    status: notebook?.status ?? "DISPONIVEL",
    notes: notebook?.notes ?? "",
  });

  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pendente, setPendente] = useState<DadosDoNotebook | null>(null);
  const [excesso, setExcesso] = useState<ExcessoDeCapacidade | null>(null);

  const opcoesDeStatus =
    notebook?.status === "DESATIVADO"
      ? [...OPCOES_DE_STATUS, { value: "DESATIVADO", label: "Desativado" }]
      : OPCOES_DE_STATUS;

  function atualizar(campo: keyof CamposDoNotebook, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }));
  }

  async function enviar(dados: DadosDoNotebook, confirmarExcesso: boolean) {
    setSalvando(true);
    setErroGeral(null);

    try {
      const corpo = confirmarExcesso
        ? { ...dados, confirmCapacityOverflow: true }
        : dados;

      if (editando) {
        await api.patch<ResultadoDaMutacao>(
          `/api/notebooks/${notebook.id}`,
          corpo,
        );
        setSucesso("Cadastro do equipamento atualizado.");
        setPendente(null);
        setExcesso(null);
        router.refresh();
        onSaved?.();
      } else {
        const criado = await api.post<{ notebook: { id: string } }>(
          "/api/notebooks",
          corpo,
        );
        router.push(`/admin/notebooks/${criado.notebook.id}`);
        router.refresh();
      }
    } catch (falha) {
      if (falha instanceof ApiError) {
        const conflito = lerExcessoDeCapacidade(falha);
        if (conflito) {
          setPendente(dados);
          setExcesso(conflito);
          return;
        }
        setErros(falha.fieldErrors);
        setErroGeral(falha.message);
      } else {
        setErroGeral("Não foi possível salvar o equipamento. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  function submeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setSucesso(null);
    setErros({});

    const resultado = createNotebookSchema.safeParse({
      assetTag: valores.assetTag,
      serialNumber: valores.serialNumber,
      nickname: valores.nickname,
      brand: valores.brand,
      model: valores.model,
      // Campo vazio significa "avulso": precisa virar null, senão a API
      // tentaria gravar uma chave estrangeira em branco.
      kitId: valores.kitId === "" ? null : valores.kitId,
      status: valores.status,
      notes: valores.notes,
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
            label="Patrimônio / etiqueta"
            required
            value={valores.assetTag}
            error={erros.assetTag}
            hint="Identificador único do equipamento. Ex.: NB-001"
            autoComplete="off"
            maxLength={40}
            onChange={(evento) => atualizar("assetTag", evento.target.value)}
          />
          <TextField
            label="Número de série"
            value={valores.serialNumber}
            error={erros.serialNumber}
            hint="Série do fabricante, se houver. Também é único."
            autoComplete="off"
            maxLength={80}
            onChange={(evento) => atualizar("serialNumber", evento.target.value)}
          />
          <TextField
            label="Apelido"
            value={valores.nickname}
            error={erros.nickname}
            hint="Nome pelo qual a equipe chama o equipamento."
            autoComplete="off"
            maxLength={60}
            onChange={(evento) => atualizar("nickname", evento.target.value)}
          />
          <SelectField
            label="Kit"
            value={valores.kitId}
            error={erros.kitId}
            placeholder="Avulso (sem kit)"
            options={opcoesDeKit(kits)}
            hint="Vincular a um kit ocupa uma vaga da capacidade dele."
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
            label="Status"
            value={valores.status}
            error={erros.status}
            options={opcoesDeStatus}
            hint="Para tirar o equipamento do inventário use “Desativar”, que preserva o histórico."
            onChange={(evento) => atualizar("status", evento.target.value)}
          />
        </div>

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
            {editando ? "Salvar alterações" : "Cadastrar notebook"}
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
        title="Kit sem vaga para este equipamento"
        confirmLabel="Vincular mesmo assim"
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
                O kit comporta <strong>{excesso.capacidade}</strong> notebook(s)
                e já tem <strong>{excesso.notebooksVinculados}</strong>{" "}
                vinculado(s).
              </p>
              <p className="mt-2">
                Confirmando, o kit fica acima da capacidade planejada e a
                exceção é registrada no histórico com o seu nome. Alternativa:
                aumentar a capacidade do kit ou escolher outro destino.
              </p>
            </>
          )
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Painel de gestão do detalhe
// ---------------------------------------------------------------------------

export function PainelDoNotebook({
  notebook,
  kits,
}: {
  notebook: NotebookParaEdicao & { statusLabel: string };
  kits: KitParaSelecao[];
}) {
  const router = useRouter();

  // O botão "Editar cadastro" dá lugar ao formulário; o hook garante que o
  // foco do teclado acompanhe essa troca nos dois sentidos.
  const {
    aberto: editando,
    abrir: abrirEdicao,
    fechar: fecharEdicao,
    painelRef: formularioRef,
    gatilhoRef: botaoEditarRef,
  } = useDisclosureFocus();

  const [status, setStatus] = useState<string>(notebook.status);
  const [kitDestino, setKitDestino] = useState<string>(notebook.kitId ?? "");

  const [processando, setProcessando] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [impacto, setImpacto] = useState<{
    quantidade: number;
    aviso: string | null;
  } | null>(null);

  const [confirmandoDesativacao, setConfirmandoDesativacao] = useState(false);
  const [excesso, setExcesso] = useState<ExcessoDeCapacidade | null>(null);

  const desativado = notebook.status === "DESATIVADO";

  const opcoesDeStatus = desativado
    ? [...OPCOES_DE_STATUS, { value: "DESATIVADO", label: "Desativado" }]
    : OPCOES_DE_STATUS;

  function limparRetorno() {
    setSucesso(null);
    setErro(null);
    setImpacto(null);
  }

  /**
   * Guarda o impacto em reservas para exibir o número na tela.
   *
   * Vale tanto para o notebook em si quanto para o aviso herdado do kit — a
   * supervisão precisa ver os dois casos, porque nos dois há professor com aula
   * marcada contando com o equipamento.
   */
  function registrarImpacto(resultado: ResultadoDaMutacao) {
    if (resultado.reservasFuturasAtivas > 0 || resultado.aviso) {
      setImpacto({
        quantidade: resultado.reservasFuturasAtivas,
        aviso: resultado.aviso,
      });
    }
  }

  async function salvarStatus() {
    setProcessando(true);
    limparRetorno();
    try {
      const resultado = await api.patch<ResultadoDaMutacao>(
        `/api/notebooks/${notebook.id}`,
        { status },
      );
      setSucesso(
        `Status alterado para “${resultado.notebook.statusLabel}”. Nenhuma reserva foi cancelada.`,
      );
      registrarImpacto(resultado);
      router.refresh();
    } catch (falha) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : "Não foi possível alterar o status. Tente novamente.",
      );
    } finally {
      setProcessando(false);
    }
  }

  async function transferir(confirmarExcesso: boolean) {
    setProcessando(true);
    limparRetorno();
    try {
      const resultado = await api.patch<ResultadoDaMutacao>(
        `/api/notebooks/${notebook.id}`,
        {
          kitId: kitDestino === "" ? null : kitDestino,
          ...(confirmarExcesso ? { confirmCapacityOverflow: true } : {}),
        },
      );
      setExcesso(null);
      setSucesso(
        kitDestino === ""
          ? "Equipamento agora é avulso, sem kit vinculado."
          : "Equipamento transferido para o novo kit.",
      );
      registrarImpacto(resultado);
      router.refresh();
    } catch (falha) {
      if (falha instanceof ApiError) {
        const conflito = lerExcessoDeCapacidade(falha);
        if (conflito) {
          setExcesso(conflito);
          return;
        }
        setErro(falha.message);
      } else {
        setErro("Não foi possível transferir o equipamento. Tente novamente.");
      }
    } finally {
      setProcessando(false);
    }
  }

  async function desativar() {
    setProcessando(true);
    limparRetorno();
    try {
      const resultado = await api.delete<ResultadoDaMutacao>(
        `/api/notebooks/${notebook.id}`,
      );
      setConfirmandoDesativacao(false);
      setSucesso(
        `Notebook ${resultado.notebook.assetTag} desativado. O histórico foi preservado.`,
      );
      registrarImpacto(resultado);
      router.refresh();
    } catch (falha) {
      setConfirmandoDesativacao(false);
      setErro(
        falha instanceof ApiError
          ? falha.message
          : "Não foi possível desativar o equipamento. Tente novamente.",
      );
    } finally {
      setProcessando(false);
    }
  }

  async function reativar() {
    setProcessando(true);
    limparRetorno();
    try {
      await api.patch<ResultadoDaMutacao>(`/api/notebooks/${notebook.id}`, {
        status: "DISPONIVEL",
      });
      setStatus("DISPONIVEL");
      setSucesso("Equipamento reativado e disponível.");
      router.refresh();
    } catch (falha) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : "Não foi possível reativar o equipamento. Tente novamente.",
      );
    } finally {
      setProcessando(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Gestão do equipamento"
        description="Editar cadastro, alterar status, transferir de kit e desativar."
        action={
          !editando && (
            <Button
              ref={botaoEditarRef}
              variant="outline"
              aria-expanded={false}
              onClick={abrirEdicao}
            >
              Editar cadastro
            </Button>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        {erro && (
          <Alert tone="danger" title="Ação recusada">
            {erro}
          </Alert>
        )}
        {sucesso && <Alert tone="success">{sucesso}</Alert>}

        {impacto && (
          <Alert
            tone="warning"
            title={
              impacto.quantidade > 0
                ? `${impacto.quantidade} reserva(s) ativa(s) dependem deste equipamento`
                : "Confira as reservas antes da próxima retirada"
            }
          >
            <p>
              {impacto.aviso ??
                "As reservas NÃO foram canceladas: avise os professores e decida se é caso de remanejar o equipamento."}
            </p>
            <a
              href="#reservas-afetadas"
              className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
            >
              Ver as reservas afetadas nesta página
            </a>
          </Alert>
        )}

        {editando ? (
          <div
            ref={formularioRef}
            tabIndex={-1}
            aria-label={`Editar cadastro do notebook ${notebook.assetTag}`}
            className="focus:outline-none"
          >
            <NotebookForm
              notebook={notebook}
              kits={kits}
              onSaved={fecharEdicao}
              onCancel={fecharEdicao}
            />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  Alterar status
                </h3>
                {desativado ? (
                  <>
                    <p className="text-sm text-slate-600">
                      O equipamento está desativado e não aparece para os
                      professores.
                    </p>
                    <Button
                      loading={processando}
                      onClick={() => void reativar()}
                    >
                      Reativar equipamento
                    </Button>
                  </>
                ) : (
                  <>
                    <SelectField
                      label="Novo status"
                      value={status}
                      options={opcoesDeStatus}
                      hint="Manutenção, perdido e indisponível tiram o equipamento de novas reservas — as já marcadas continuam de pé."
                      onChange={(evento) => setStatus(evento.target.value)}
                    />
                    <Button
                      variant="secondary"
                      loading={processando}
                      disabled={status === notebook.status}
                      onClick={() => void salvarStatus()}
                    >
                      Salvar status
                    </Button>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  Transferir de kit
                </h3>
                <SelectField
                  label="Kit de destino"
                  value={kitDestino}
                  placeholder="Avulso (sem kit)"
                  options={opcoesDeKit(kits)}
                  hint="Sair de um kit libera a vaga na origem; entrar em outro ocupa uma vaga no destino."
                  onChange={(evento) => setKitDestino(evento.target.value)}
                />
                <Button
                  variant="secondary"
                  loading={processando}
                  disabled={kitDestino === (notebook.kitId ?? "")}
                  onClick={() => void transferir(false)}
                >
                  Transferir
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-800">
                Outras ações
              </h3>
              <div className="flex flex-wrap gap-2">
                <a
                  href="#ocorrencias"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  Ver ocorrências
                </a>
                <a
                  href="#historico"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  Ver histórico
                </a>
                {!desativado && (
                  <Button
                    variant="danger"
                    onClick={() => setConfirmandoDesativacao(true)}
                  >
                    Desativar equipamento
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </CardBody>

      <ConfirmDialog
        open={confirmandoDesativacao}
        title={`Desativar o notebook ${notebook.assetTag}?`}
        confirmLabel="Desativar"
        cancelLabel="Cancelar"
        loading={processando}
        onConfirm={() => void desativar()}
        onCancel={() => setConfirmandoDesativacao(false)}
        description={
          <>
            <p>
              A desativação é lógica: o equipamento continua nas reservas
              antigas, nas ocorrências e no histórico, mas sai do inventário
              ativo e não pode mais ser reservado.
            </p>
            <p className="mt-2">
              Se o notebook tiver reserva ativa própria, a operação será
              recusada. Para uma saída temporária de circulação, use o status
              “Em manutenção” ou “Indisponível”.
            </p>
          </>
        }
      />

      <ConfirmDialog
        open={excesso !== null}
        title="Kit de destino sem vaga"
        confirmLabel="Transferir mesmo assim"
        cancelLabel="Voltar e ajustar"
        confirmVariant="danger"
        loading={processando}
        onConfirm={() => void transferir(true)}
        onCancel={() => setExcesso(null)}
        description={
          excesso && (
            <p>
              O kit escolhido comporta <strong>{excesso.capacidade}</strong>{" "}
              notebook(s) e já tem{" "}
              <strong>{excesso.notebooksVinculados}</strong> vinculado(s).
              Confirmando, o kit fica acima do planejado e a exceção vai para o
              histórico.
            </p>
          )
        }
      />
    </Card>
  );
}
