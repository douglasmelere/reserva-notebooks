"use client";

import {
  CalendarClock,
  CircleCheck,
  CircleSlash,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Alert, Badge, type BadgeTone } from "@/components/ui/primitives";
import type {
  AvailabilityState,
  KitAvailability,
  NotebookAvailability,
  Occupation,
} from "@/server/availability";

/**
 * Cartão de um recurso na consulta de disponibilidade.
 *
 * É Client Component porque duas coisas acontecem sem recarregar a página:
 * abrir os dados de quem está com o equipamento e pedir o link de contato.
 *
 * Os dados do ocupante exibidos aqui são exatamente os que a API devolve —
 * nome, período, sala e finalidade. Telefone e e-mail nunca chegam ao
 * navegador: o servidor monta o link do WhatsApp e devolve só a URL pronta.
 */

export type Recurso = KitAvailability | NotebookAvailability;

type ContatoResposta =
  | { disponivel: true; url: string; mensagem: string }
  | { disponivel: false; motivo: string };

const ESTADO: Record<
  AvailabilityState,
  { rotulo: string; tone: BadgeTone; barra: string; icone: LucideIcon }
> = {
  DISPONIVEL: {
    rotulo: "Disponível",
    tone: "success",
    barra: "bg-emerald-500",
    icone: CircleCheck,
  },
  RESERVADO: {
    rotulo: "Reservado",
    tone: "info",
    barra: "bg-senai-500",
    icone: CalendarClock,
  },
  MANUTENCAO: {
    rotulo: "Em manutenção",
    tone: "warning",
    barra: "bg-amber-500",
    icone: Wrench,
  },
  INDISPONIVEL: {
    rotulo: "Indisponível",
    tone: "danger",
    barra: "bg-red-500",
    icone: CircleSlash,
  },
};

const TIPO_KIT: Record<KitAvailability["type"], string> = {
  MALETA: "Maleta",
  CARRINHO: "Carrinho",
};

export function RecursoCard({ recurso }: { recurso: Recurso }) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const estado = ESTADO[recurso.state];

  const titulo =
    recurso.kind === "kit"
      ? recurso.name
      : (recurso.nickname ?? `Notebook ${recurso.assetTag}`);

  const detalhes =
    recurso.kind === "kit"
      ? [
          TIPO_KIT[recurso.type],
          `Código ${recurso.code}`,
          `${recurso.notebookCount} de ${recurso.capacity} notebooks`,
          recurso.location ? `Local: ${recurso.location}` : null,
        ]
      : [
          `Patrimônio ${recurso.assetTag}`,
          [recurso.brand, recurso.model].filter(Boolean).join(" ") || null,
          recurso.kitName ? `Dentro do kit ${recurso.kitName}` : "Avulso",
        ];

  const ocupado = recurso.occupations.length > 0;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
      {/* Barra de cor como reforço do selo — nunca como único sinal. */}
      <div className={cn("h-1.5 w-full", estado.barra)} aria-hidden="true" />

      <div className="px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {/* Nome de kit cadastrado sem espaço ("MaletaInformatica-Bloco-B")
              estouraria o cartão sem o `break-words`. */}
          <h3 className="min-w-0 text-sm font-semibold break-words text-slate-900">
            {titulo}
          </h3>
          <Badge tone={estado.tone}>
            <estado.icone aria-hidden="true" className="size-3.5" />
            {estado.rotulo}
          </Badge>
        </div>

        <p className="mt-1 text-xs text-slate-600">
          {detalhes.filter(Boolean).join(" · ")}
        </p>

        {recurso.kind === "kit" && recurso.chargerKit && (
          <p className="mt-1 text-xs text-slate-600">
            Carregadores: {recurso.chargerKit.availableQuantity} de{" "}
            {recurso.chargerKit.totalQuantity}
            {recurso.chargerKit.completo
              ? " (kit completo)"
              : " (kit incompleto)"}
          </p>
        )}

        {(recurso.state === "MANUTENCAO" ||
          recurso.state === "INDISPONIVEL") && (
          <p className="mt-2 text-xs text-slate-600">
            Situação no cadastro: {recurso.statusLabel}. Este equipamento não
            pode ser reservado até a supervisão liberá-lo.
          </p>
        )}

        {ocupado && (
          <>
            {/* Tamanho padrão (44px de altura): é o alvo de toque mínimo, e
                este botão é tocado no celular, em pé no corredor. */}
            <Button
              variant="outline"
              className="mt-3"
              aria-expanded={aberto}
              aria-controls={painelId}
              onClick={() => setAberto((v) => !v)}
            >
              {aberto
                ? "Ocultar quem está com o equipamento"
                : "Ver quem está com o equipamento"}
              {/* A tela repete este botão em cada cartão; sem o nome, quem
                  navega pela lista de botões ouve tudo igual. */}
              <span className="sr-only"> — {titulo}</span>
            </Button>

            <div id={painelId} hidden={!aberto} className="mt-3">
              <ul className="flex flex-col gap-3">
                {recurso.occupations.map((ocupacao) => (
                  <li key={`${ocupacao.reservationId}-${ocupacao.startsAt}`}>
                    <Ocupante ocupacao={ocupacao} />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

/**
 * Dados do ocupante e o atalho de conversa.
 *
 * O texto deixa claro que falar com o colega não muda nada no sistema: quem
 * decide ceder o equipamento é ele, fora daqui.
 */
function Ocupante({ ocupacao }: { ocupacao: Occupation }) {
  const [carregando, setCarregando] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [linkAberto, setLinkAberto] = useState<string | null>(null);

  async function contatar() {
    setCarregando(true);
    setErro(null);
    setMotivo(null);
    setLinkAberto(null);
    try {
      const resposta = await api.post<ContatoResposta>(
        `/api/reservations/${ocupacao.reservationId}/whatsapp`,
      );
      if (resposta.disponivel) {
        // `noopener` impede que a aba do WhatsApp acesse esta janela.
        window.open(resposta.url, "_blank", "noopener");
        // Com `noopener` o navegador devolve `null` mesmo quando a aba abriu,
        // então não dá para saber se o bloqueador de pop-up barrou. Em vez de
        // deixar o professor olhando para uma tela que não mudou, mostramos o
        // link para ele abrir na mão.
        setLinkAberto(resposta.url);
      } else {
        setMotivo(resposta.motivo);
      }
    } catch (error) {
      setErro(
        error instanceof ApiError
          ? error.message
          : "Não foi possível gerar o contato agora. Tente novamente.",
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3">
      {/* `minmax(0,1fr)` na segunda coluna: com `1fr` puro o conteúdo define o
          mínimo da coluna e um nome longo empurraria o cartão para fora. */}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="font-medium text-slate-600">Professor(a)</dt>
        <dd className="break-words text-slate-900">
          {ocupacao.holder.fullName}
        </dd>

        <dt className="font-medium text-slate-600">Período</dt>
        <dd className="break-words text-slate-900">
          {ocupacao.periodoFormatado}
        </dd>

        <dt className="font-medium text-slate-600">Sala</dt>
        <dd className="break-words text-slate-900">
          {ocupacao.room ?? "Não informada"}
        </dd>

        <dt className="font-medium text-slate-600">Finalidade</dt>
        <dd className="break-words text-slate-900">
          {ocupacao.purpose ?? "Não informada"}
        </dd>
      </dl>

      {ocupacao.holder.whatsappDisponivel ? (
        <div className="mt-3">
          <Button
            variant="secondary"
            loading={carregando}
            onClick={contatar}
            icon={<span aria-hidden="true">💬</span>}
          >
            Entrar em contato via WhatsApp
            <span className="sr-only"> com {ocupacao.holder.fullName}</span>
          </Button>
          <p className="mt-2 text-xs text-slate-600">
            O contato abre uma conversa no WhatsApp com a mensagem já escrita.
            Ele <strong>não altera a reserva</strong> e{" "}
            <strong>não garante o equipamento</strong>: quem decide emprestar é
            o(a) colega. O número não aparece aqui — o sistema apenas monta o
            link, e registra que você pediu o contato.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-600">
          Este(a) docente não disponibilizou contato por WhatsApp. Procure a
          supervisão para verificar alternativas.
        </p>
      )}

      {/* Respostas assíncronas precisam ser anunciadas: o retorno pode ser só
          um texto novo, sem mudança de foco. Quem anuncia é o próprio `Alert`
          (`role="alert"`/`role="status"`) — um `aria-live` aqui aninharia duas
          regiões vivas e o leitor de tela leria a mensagem duas vezes. */}
      <div>
        {linkAberto && (
          <Alert tone="success" className="mt-3">
            Abrimos a conversa no WhatsApp em outra aba. Se nada apareceu, o
            navegador pode ter bloqueado a janela —{" "}
            <a
              href={linkAberto}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline"
            >
              abra a conversa por aqui
            </a>
            .
          </Alert>
        )}
        {motivo && (
          <Alert tone="info" className="mt-3">
            {motivo}
          </Alert>
        )}
        {erro && (
          <Alert tone="danger" className="mt-3">
            {erro}
          </Alert>
        )}
      </div>
    </div>
  );
}
