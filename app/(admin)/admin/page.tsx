import Link from "next/link";
import type { ReactNode } from "react";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  TableWrapper,
  Td,
  Th,
  type BadgeTone,
} from "@/components/ui/primitives";
import { formatDateTimeBR } from "@/lib/datetime";
import { getDashboard, type NivelAlerta } from "@/server/dashboard";
import type { IncidentSeverity } from "@/generated/prisma/enums";
import { BuscaGlobal } from "./busca-global";

export const dynamic = "force-dynamic";

export const metadata = { title: "Painel da supervisão" };

/** Quantas devoluções pendentes cabem no alerta antes de virar "e mais N". */
const MAX_ALERTAS_VISIVEIS = 6;

const TOM_POR_NIVEL: Record<NivelAlerta, BadgeTone> = {
  ATENCAO: "warning",
  ALTO: "danger",
  CRITICO: "danger",
};

const ROTULO_NIVEL: Record<NivelAlerta, string> = {
  ATENCAO: "Atenção",
  ALTO: "Atraso alto",
  CRITICO: "Crítico",
};

const TOM_POR_SEVERIDADE: Record<IncidentSeverity, BadgeTone> = {
  CRITICA: "danger",
  ALTA: "warning",
  MEDIA: "info",
  BAIXA: "neutral",
};

/**
 * Painel da supervisão.
 *
 * Server Component: chama `getDashboard()` direto, sem passar pela própria API.
 * A ordem dos blocos é a ordem da urgência — quem abre esta tela às 7h40 precisa
 * ver primeiro o que já deu errado, não o gráfico do mês.
 */
export default async function PainelPage() {
  const dados = await getDashboard();

  const devolucoes = dados.alertasDevolucaoPendente;
  const criticas =
    dados.ocorrenciasAbertas.porSeveridade.find(
      (item) => item.severidade === "CRITICA",
    )?.total ?? 0;

  // Um atraso de mais de duas horas já é problema operacional, não lembrete.
  const devolucaoGrave = devolucoes.some((item) => item.nivel !== "ATENCAO");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Painel da supervisão"
        description={`Situação de ${formatDateTimeBR(new Date(dados.geradoEm))}.`}
      />

      <BuscaGlobal />

      {/* 1. Alertas ------------------------------------------------------- */}
      <section aria-labelledby="titulo-alertas" className="flex flex-col gap-3">
        <h2 id="titulo-alertas" className="sr-only">
          Alertas
        </h2>

        {devolucoes.length === 0 && criticas === 0 && (
          <Alert tone="success" title="Nenhuma pendência urgente">
            Não há devoluções atrasadas nem ocorrências críticas em aberto neste
            momento.
          </Alert>
        )}

        {devolucoes.length > 0 && (
          <Alert
            tone={devolucaoGrave ? "danger" : "warning"}
            title={`${dados.indicadores.devolucoesPendentes} devolução(ões) pendente(s)`}
          >
            <p>
              O período dessas reservas terminou e elas ainda não foram
              encerradas — o equipamento continua bloqueado para as próximas
              turmas.
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {devolucoes.slice(0, MAX_ALERTAS_VISIVEIS).map((alerta) => (
                <li
                  key={alerta.reservationId}
                  className="flex flex-wrap items-center gap-2"
                >
                  <Badge tone={TOM_POR_NIVEL[alerta.nivel]}>
                    {ROTULO_NIVEL[alerta.nivel]}
                  </Badge>
                  <Link
                    href={`/reservas/${alerta.reservationId}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {alerta.code}
                  </Link>
                  <span>
                    {alerta.professor.fullName} · {alerta.periodoFormatado} ·
                    atraso de {formatarAtraso(alerta.atrasoHoras)}
                  </span>
                  {alerta.contatoWhatsappDisponivel && (
                    <Badge tone="info">Aceita contato por WhatsApp</Badge>
                  )}
                </li>
              ))}
            </ul>
            {dados.indicadores.devolucoesPendentes > MAX_ALERTAS_VISIVEIS && (
              <p className="mt-2">
                e mais{" "}
                {dados.indicadores.devolucoesPendentes - MAX_ALERTAS_VISIVEIS}{" "}
                reserva(s) na mesma situação.
              </p>
            )}
            <p className="mt-2">
              <LinkAcao href="/admin/reservas">
                Abrir todas as reservas
              </LinkAcao>
            </p>
          </Alert>
        )}

        {criticas > 0 && (
          <Alert
            tone="danger"
            title={`${criticas} ocorrência(s) crítica(s) em aberto`}
          >
            <p>
              Ocorrências críticas travam equipamento e costumam impedir aula.
              Trate-as antes de liberar novas reservas do mesmo recurso.
            </p>
            <p className="mt-2">
              <LinkAcao href="/admin/ocorrencias">
                Abrir as ocorrências
              </LinkAcao>
            </p>
          </Alert>
        )}
      </section>

      {/* 2. Números do dia ------------------------------------------------ */}
      <section aria-labelledby="titulo-numeros" className="flex flex-col gap-3">
        <h2
          id="titulo-numeros"
          className="text-base font-semibold text-slate-900"
        >
          Números do dia
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Reservas hoje"
            value={dados.indicadores.reservasHoje}
            tone="info"
            hint="Agenda do dia, sem canceladas"
          />
          <Stat
            label="Próximas"
            value={dados.indicadores.reservasProximas}
            hint="Próximos 7 dias"
          />
          <Stat
            label="Atrasadas"
            value={dados.indicadores.devolucoesPendentes}
            tone={dados.indicadores.devolucoesPendentes > 0 ? "danger" : "success"}
            hint="Devolução pendente"
          />
          <Stat
            label="Kits em uso"
            value={dados.indicadores.kitsEmUso}
            tone="info"
            hint="Neste momento"
          />
          <Stat
            label="Notebooks livres"
            value={dados.notebooksPorStatus.disponiveis}
            tone={dados.notebooksPorStatus.disponiveis > 0 ? "success" : "warning"}
            hint={`de ${dados.notebooksPorStatus.total} cadastrados`}
          />
          <Stat
            label="Ocorrências"
            value={dados.ocorrenciasAbertas.total}
            tone={dados.ocorrenciasAbertas.total > 0 ? "warning" : "success"}
            hint="Em aberto"
          />
        </div>
      </section>

      {/* 3. Kits em uso agora --------------------------------------------- */}
      <Card>
        <CardHeader
          title="Kits em uso agora"
          description="Maletas e carrinhos que estão fora da sala de guarda neste instante."
          action={<LinkAcao href="/admin/reservas">Ver reservas</LinkAcao>}
        />
        <CardBody>
          {dados.kitsEmUso.length === 0 ? (
            <EmptyState
              title="Nenhum kit em uso agora"
              description="Todos os kits estão guardados. Quando uma reserva entrar no horário, ela aparece aqui com professor, período e sala."
              action={
                <LinkAcao href="/admin/kits">Ver kits e carrinhos</LinkAcao>
              }
            />
          ) : (
            <TableWrapper>
              <caption className="sr-only">
                Kits em uso agora, com professor responsável, período e sala.
              </caption>
              <thead>
                <tr>
                  <Th>Kit</Th>
                  <Th>Professor(a)</Th>
                  <Th>Período</Th>
                  <Th>Sala</Th>
                </tr>
              </thead>
              <tbody>
                {dados.kitsEmUso.map((kit) => (
                  <tr key={`${kit.kitId}-${kit.reservationId}`}>
                    <Td>
                      <span className="font-medium text-slate-900">
                        {kit.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {kit.code} ·{" "}
                        {kit.type === "MALETA" ? "Maleta" : "Carrinho"}
                      </span>
                    </Td>
                    <Td>
                      {kit.professor.fullName}
                      <Link
                        href={`/reservas/${kit.reservationId}`}
                        className="block text-xs text-sky-800 underline underline-offset-2"
                      >
                        Reserva {kit.reservationCode}
                      </Link>
                    </Td>
                    <Td>{kit.periodoFormatado}</Td>
                    <Td>{kit.room ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          )}
        </CardBody>
      </Card>

      {/* 4. Ocorrências abertas por severidade ---------------------------- */}
      <Card>
        <CardHeader
          title="Ocorrências abertas por severidade"
          description="Inclui as reabertas como recorrentes; resolvidas e descartadas ficam de fora."
          action={
            <LinkAcao href="/admin/ocorrencias">Ver ocorrências</LinkAcao>
          }
        />
        <CardBody>
          {dados.ocorrenciasAbertas.total === 0 ? (
            <EmptyState
              title="Nenhuma ocorrência em aberto"
              description="Nada pendente de conserto ou análise. Novos problemas registrados por professores aparecem aqui assim que chegam."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {dados.ocorrenciasAbertas.porSeveridade.map((item) => (
                <li
                  key={item.severidade}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3"
                >
                  <Badge tone={TOM_POR_SEVERIDADE[item.severidade]}>
                    {item.label}
                  </Badge>
                  <span className="text-xl font-bold tabular-nums text-slate-900">
                    {item.total}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 5. Carregadores incompletos -------------------------------------- */}
      <Card>
        <CardHeader
          title="Carregadores incompletos"
          description="Kits de carregador com peça faltando — o professor descobre isso na sala, então vale resolver antes."
          action={
            <LinkAcao href="/admin/carregadores">Ver carregadores</LinkAcao>
          }
        />
        <CardBody>
          {dados.carregadoresIncompletos.length === 0 ? (
            <EmptyState
              title="Todos os kits de carregadores estão completos"
              description="Nenhuma peça faltando no estoque. Se encontrar uma diferença na conferência, ajuste a quantidade disponível na tela de carregadores."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {dados.carregadoresIncompletos.map((carregador) => (
                <li
                  key={carregador.chargerKitId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {carregador.code}
                      {carregador.kitName ? ` · ${carregador.kitName}` : " · Avulso"}
                    </p>
                    <p className="text-xs text-slate-600">
                      {carregador.availableQuantity} de{" "}
                      {carregador.totalQuantity} disponíveis
                      {carregador.missingParts
                        ? ` · falta: ${carregador.missingParts}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warning">
                      Faltam {carregador.faltando} carregador(es)
                    </Badge>
                    <Badge
                      tone={
                        carregador.status === "MANUTENCAO" ? "warning" : "neutral"
                      }
                    >
                      {carregador.statusLabel}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 6. Utilização dos kits ------------------------------------------- */}
      <Card>
        <CardHeader
          title={`Utilização dos kits (${dados.utilizacaoKits.janelaDias} dias)`}
          description={`${dados.utilizacaoKits.totalReservas} reserva(s) no período. A barra mostra em quantos dos ${dados.utilizacaoKits.janelaDias} dias o kit rodou ao menos uma vez.`}
          action={<LinkAcao href="/admin/kits">Ver kits e carrinhos</LinkAcao>}
        />
        <CardBody>
          {dados.utilizacaoKits.itens.length === 0 ? (
            <EmptyState
              title="Nenhum kit ativo cadastrado"
              description="Cadastre uma maleta ou um carrinho para começar a acompanhar a utilização."
              action={<LinkAcao href="/admin/kits">Cadastrar kit</LinkAcao>}
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {dados.utilizacaoKits.itens.map((kit) => {
                const percentual = Math.round(kit.taxaUso * 100);
                return (
                  <li key={kit.kitId} className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">
                        {kit.name}{" "}
                        <span className="font-normal text-slate-500">
                          ({kit.code})
                        </span>
                      </span>
                      <span className="text-sm tabular-nums text-slate-700">
                        {kit.diasUtilizados} de {dados.utilizacaoKits.janelaDias}{" "}
                        dias ({percentual}%) · {kit.reservas} reserva(s)
                      </span>
                    </div>
                    {/* Barra apenas ilustrativa: o número já está no texto
                        acima, então ela fica fora da árvore de acessibilidade. */}
                    <div
                      aria-hidden="true"
                      className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
                    >
                      <div
                        className="h-full rounded-full bg-sky-700"
                        style={{ width: `${Math.max(percentual, kit.reservas > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      {kit.statusLabel} ·{" "}
                      {kit.ultimaReserva
                        ? `última reserva em ${kit.ultimaReserva}`
                        : "sem reservas no período"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/** Link com aparência de ação e alvo de toque de 44px. */
function LinkAcao({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
    >
      {children}
    </Link>
  );
}

/** "3 horas", "2 dias" — o número cru em horas não ajuda quem está no balcão. */
function formatarAtraso(horas: number): string {
  if (horas < 1) return "menos de 1 hora";
  if (horas < 24) return `${Math.floor(horas)} hora(s)`;
  return `${Math.floor(horas / 24)} dia(s)`;
}
