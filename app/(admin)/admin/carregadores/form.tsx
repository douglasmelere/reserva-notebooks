"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { api, ApiError } from "@/lib/api-client";
import { createChargerKitSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { useDisclosureFocus } from "@/components/ui/use-disclosure-focus";

/**
 * Cadastro, edição e desativação de kits de carregadores.
 *
 * DECISÃO QUE A INTERFACE PRECISA DEIXAR CLARA: "Completo" e "Incompleto" não
 * são escolhidos por ninguém — saem da comparação entre disponível e total e
 * são recalculados a cada gravação. A supervisão só define manualmente
 * "Em manutenção" e "Indisponível"; escolher "Automático" devolve o registro à
 * derivação pelas quantidades.
 */

export type KitVinculavel = {
  id: string;
  code: string;
  name: string;
  /** Código do kit de carregadores que já ocupa a vaga 1-1, se houver. */
  chargerKitCode: string | null;
};

export type CarregadorEditavel = {
  id: string;
  code: string;
  kitId: string | null;
  totalQuantity: number;
  availableQuantity: number;
  missingParts: string | null;
  notes: string | null;
  /** Status atual, já resolvido pelo servidor. */
  status: string;
};

type DadosDoCarregador = z.infer<typeof createChargerKitSchema>;

type CamposDoCarregador = {
  code: string;
  kitId: string;
  totalQuantity: string;
  availableQuantity: string;
  status: string;
  missingParts: string;
  notes: string;
};

/**
 * "AUTO" não é um status da API: é o pedido de voltar a derivar das
 * quantidades. Na gravação ele vira `COMPLETO`, que o servidor lê exatamente
 * assim — quem decide entre completo e incompleto é a contagem.
 */
const OPCOES_DE_STATUS = [
  {
    value: "AUTO",
    label: "Automático — completo/incompleto pela contagem",
  },
  { value: "MANUTENCAO", label: "Em manutenção (decisão da supervisão)" },
  { value: "INDISPONIVEL", label: "Indisponível (decisão da supervisão)" },
];

function camposDoZod(erro: z.ZodError): Record<string, string[]> {
  const campos: Record<string, string[]> = {};
  for (const problema of erro.issues) {
    const chave = problema.path.map(String).join(".") || "_";
    (campos[chave] ??= []).push(problema.message);
  }
  return campos;
}

function opcoesDeKit(kits: KitVinculavel[], kitAtual: string | null) {
  return kits.map((kit) => {
    const ocupadoPorOutro =
      kit.chargerKitCode !== null && kit.id !== kitAtual;
    return {
      value: kit.id,
      label: ocupadoPorOutro
        ? `${kit.name} (${kit.code}) — já usa ${kit.chargerKitCode}`
        : `${kit.name} (${kit.code})`,
      // Cada maleta/carrinho comporta um único kit de carregadores.
      disabled: ocupadoPorOutro,
    };
  });
}

// ---------------------------------------------------------------------------
// Formulário compartilhado por cadastro e edição
// ---------------------------------------------------------------------------

function FormularioDeCarregadores({
  carregador,
  kits,
  onSaved,
  onCancel,
}: {
  carregador?: CarregadorEditavel;
  kits: KitVinculavel[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const editando = carregador !== undefined;

  const [valores, setValores] = useState<CamposDoCarregador>({
    code: carregador?.code ?? "",
    kitId: carregador?.kitId ?? "",
    totalQuantity: carregador ? String(carregador.totalQuantity) : "",
    availableQuantity: carregador ? String(carregador.availableQuantity) : "",
    status:
      carregador?.status === "MANUTENCAO" ||
      carregador?.status === "INDISPONIVEL"
        ? carregador.status
        : "AUTO",
    missingParts: carregador?.missingParts ?? "",
    notes: carregador?.notes ?? "",
  });

  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const total = Number(valores.totalQuantity);
  const disponivel = Number(valores.availableQuantity);
  const contagemValida =
    Number.isFinite(total) &&
    Number.isFinite(disponivel) &&
    valores.totalQuantity !== "" &&
    valores.availableQuantity !== "";
  const faltando = contagemValida ? Math.max(0, total - disponivel) : null;
  const disponivelMaiorQueTotal = contagemValida && disponivel > total;

  function atualizar(campo: keyof CamposDoCarregador, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }));
  }

  async function enviar(dados: DadosDoCarregador) {
    setSalvando(true);
    setErroGeral(null);
    try {
      if (editando) {
        await api.patch(`/api/charger-kits/${carregador.id}`, dados);
      } else {
        await api.post("/api/charger-kits", dados);
      }
      router.refresh();
      onSaved();
    } catch (falha) {
      if (falha instanceof ApiError) {
        setErros(falha.fieldErrors);
        setErroGeral(falha.message);
      } else {
        setErroGeral("Não foi possível salvar. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  function submeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErros({});
    setErroGeral(null);

    // O esquema compartilhado valida cada quantidade isoladamente, mas não a
    // relação entre elas — quem recusa "disponível > total" é o servidor. O
    // campo já mostra o problema em vermelho; barrar aqui evita um envio que
    // sabidamente voltaria com erro.
    if (disponivelMaiorQueTotal) {
      setErroGeral(
        `A quantidade disponível (${disponivel}) não pode ser maior que a total (${total}). ` +
          "Corrija uma das duas antes de salvar.",
      );
      return;
    }

    const resultado = createChargerKitSchema.safeParse({
      code: valores.code,
      kitId: valores.kitId === "" ? null : valores.kitId,
      totalQuantity: valores.totalQuantity,
      availableQuantity: valores.availableQuantity,
      // Em "AUTO": na criação o campo simplesmente não vai; na edição enviamos
      // COMPLETO, que o servidor entende como "volte a derivar da contagem".
      status:
        valores.status === "AUTO"
          ? editando
            ? "COMPLETO"
            : undefined
          : valores.status,
      missingParts: valores.missingParts,
      notes: valores.notes,
    });

    if (!resultado.success) {
      setErros(camposDoZod(resultado.error));
      setErroGeral("Verifique os campos destacados antes de salvar.");
      return;
    }

    void enviar(resultado.data);
  }

  return (
    <form onSubmit={submeter} className="flex flex-col gap-4" noValidate>
      {erroGeral && (
        <Alert tone="danger" title="Não foi possível salvar">
          {erroGeral}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Código"
          required
          value={valores.code}
          error={erros.code}
          hint="Identificador único. Ex.: CAR-01"
          autoComplete="off"
          maxLength={40}
          onChange={(evento) => atualizar("code", evento.target.value)}
        />
        <SelectField
          label="Maleta/carrinho vinculado"
          value={valores.kitId}
          error={erros.kitId}
          placeholder="Sem vínculo (avulso)"
          options={opcoesDeKit(kits, carregador?.kitId ?? null)}
          hint="Cada maleta ou carrinho comporta um único kit de carregadores."
          onChange={(evento) => atualizar("kitId", evento.target.value)}
        />
        <TextField
          label="Quantidade total"
          required
          type="number"
          inputMode="numeric"
          min={0}
          max={200}
          value={valores.totalQuantity}
          error={erros.totalQuantity}
          hint="Quantos carregadores este kit deveria ter."
          onChange={(evento) => atualizar("totalQuantity", evento.target.value)}
        />
        <TextField
          label="Quantidade disponível"
          required
          type="number"
          inputMode="numeric"
          min={0}
          max={200}
          value={valores.availableQuantity}
          error={
            erros.availableQuantity ??
            (disponivelMaiorQueTotal
              ? "Deve ser menor ou igual à quantidade total."
              : undefined)
          }
          hint="Quantos estão de fato no kit hoje."
          onChange={(evento) =>
            atualizar("availableQuantity", evento.target.value)
          }
        />
      </div>

      <div
        aria-live="polite"
        className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
      >
        {contagemValida && !disponivelMaiorQueTotal ? (
          <>
            Com {disponivel} de {total} carregador(es),{" "}
            {faltando === 0 ? (
              <>
                o sistema vai marcar este kit como <strong>Completo</strong>.
              </>
            ) : (
              <>
                faltam {faltando} e o sistema vai marcá-lo como{" "}
                <strong>Incompleto</strong>.
              </>
            )}
          </>
        ) : (
          "Informe as quantidades para ver como o status será calculado."
        )}
      </div>

      <SelectField
        label="Status"
        value={valores.status}
        error={erros.status}
        options={OPCOES_DE_STATUS}
        hint="Completo e incompleto são calculados; escolha manual só para manutenção ou indisponível. Voltar para “automático” devolve o cálculo às quantidades."
        onChange={(evento) => atualizar("status", evento.target.value)}
      />

      <TextField
        label="Peças faltantes"
        value={valores.missingParts}
        error={erros.missingParts}
        hint="O que está faltando, para a próxima conferência. Ex.: 2 fontes 65W."
        maxLength={300}
        onChange={(evento) => atualizar("missingParts", evento.target.value)}
      />

      <TextAreaField
        label="Observações internas"
        value={valores.notes}
        error={erros.notes}
        maxLength={500}
        onChange={(evento) => atualizar("notes", evento.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={salvando}>
          {editando ? "Salvar alterações" : "Cadastrar kit de carregadores"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={salvando}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

export function NovoKitDeCarregadores({ kits }: { kits: KitVinculavel[] }) {
  const { aberto, abrir, fechar, painelRef, gatilhoRef } =
    useDisclosureFocus<HTMLDivElement>();

  if (!aberto) {
    return (
      <Button ref={gatilhoRef} aria-expanded={false} onClick={abrir}>
        <span aria-hidden="true">＋</span> Cadastrar kit de carregadores
      </Button>
    );
  }

  return (
    <div
      ref={painelRef}
      tabIndex={-1}
      aria-label="Cadastrar kit de carregadores"
      className="focus:outline-none"
    >
      <Card>
        <CardHeader
          title="Novo kit de carregadores"
          description="Vincule a uma maleta/carrinho agora ou deixe avulso e vincule depois."
        />
        <CardBody>
          <FormularioDeCarregadores
            kits={kits}
            onSaved={fechar}
            onCancel={fechar}
          />
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ações de um kit existente
// ---------------------------------------------------------------------------

export function AcoesDoKitDeCarregadores({
  carregador,
  kits,
}: {
  carregador: CarregadorEditavel;
  kits: KitVinculavel[];
}) {
  const router = useRouter();
  const {
    aberto: editando,
    abrir: abrirEdicao,
    fechar: fecharEdicao,
    painelRef: formularioRef,
    gatilhoRef: botaoEditarRef,
  } = useDisclosureFocus<HTMLDivElement>();
  const [confirmando, setConfirmando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  const desativado = carregador.status === "DESATIVADO";

  async function desativar() {
    setProcessando(true);
    setErro(null);
    setSucesso(null);
    try {
      const resposta = await api.delete<{ mensagem: string }>(
        `/api/charger-kits/${carregador.id}`,
      );
      setConfirmando(false);
      setSucesso(resposta.mensagem);
      router.refresh();
    } catch (falha) {
      setConfirmando(false);
      setErro(
        falha instanceof ApiError
          ? falha.message
          : "Não foi possível desativar. Tente novamente.",
      );
    } finally {
      setProcessando(false);
    }
  }

  if (editando) {
    return (
      <div
        ref={formularioRef}
        tabIndex={-1}
        aria-label={`Editar o kit de carregadores ${carregador.code}`}
        className="focus:outline-none"
      >
        <FormularioDeCarregadores
          carregador={carregador}
          kits={kits}
          onSaved={fecharEdicao}
          onCancel={fecharEdicao}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {erro && (
        <Alert tone="danger" title="Ação recusada">
          {erro}
        </Alert>
      )}
      {sucesso && <Alert tone="success">{sucesso}</Alert>}

      <div className="flex flex-wrap gap-2">
        <Button
          ref={botaoEditarRef}
          variant="outline"
          aria-expanded={false}
          onClick={abrirEdicao}
        >
          Editar
          <span className="sr-only"> o kit {carregador.code}</span>
        </Button>
        {!desativado && (
          // A página lista vários cartões: "Editar"/"Desativar" sozinhos, na
          // lista de links e botões do leitor de tela, não diriam de qual kit
          // se trata.
          <Button variant="danger" onClick={() => setConfirmando(true)}>
            Desativar
            <span className="sr-only"> o kit {carregador.code}</span>
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmando}
        title={`Desativar o kit ${carregador.code}?`}
        confirmLabel="Desativar"
        cancelLabel="Cancelar"
        loading={processando}
        onConfirm={() => void desativar()}
        onCancel={() => setConfirmando(false)}
        description={
          <>
            <p>
              O registro não é apagado: recebe o status “Desativado”, sai do
              inventário ativo e é desvinculado da maleta/carrinho, liberando a
              vaga para um kit de reposição.
            </p>
            <p className="mt-2">
              O histórico e as ocorrências ligadas a ele continuam disponíveis.
            </p>
          </>
        }
      />
    </div>
  );
}
