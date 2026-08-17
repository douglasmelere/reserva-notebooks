"use client";

import {
  Boxes,
  FolderOpen,
  Laptop,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, api, queryString } from "@/lib/api-client";
import { TextField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/**
 * Busca global do painel.
 *
 * Os tipos abaixo espelham a resposta de `GET /api/search`. São declarados aqui,
 * e não importados da rota, para que este componente de cliente não arraste no
 * grafo de módulos um arquivo que importa Prisma e sessão.
 */
type ResultadoBusca = {
  id: string;
  titulo: string;
  subtitulo: string;
  href: string;
};

type GrupoBusca = {
  tipo: "reservas" | "kits" | "notebooks" | "ocorrencias" | "professores";
  rotulo: string;
  itens: ResultadoBusca[];
};

type RespostaBusca = {
  termo: string;
  total: number;
  grupos: GrupoBusca[];
};

/** Ícone por tipo: decorativo, sempre ao lado do rótulo escrito do grupo. */
const ICONE_GRUPO: Record<GrupoBusca["tipo"], LucideIcon> = {
  reservas: FolderOpen,
  kits: Boxes,
  notebooks: Laptop,
  ocorrencias: TriangleAlert,
  professores: Users,
};

/** A API recusa termos com menos de 2 caracteres; nem chegamos a chamá-la. */
const MINIMO_CARACTERES = 2;
const ATRASO_DIGITACAO_MS = 300;

export function BuscaGlobal() {
  const router = useRouter();
  const listaId = useId();
  const opcaoId = (indice: number) => `${listaId}-opcao-${indice}`;
  const grupoId = (tipo: GrupoBusca["tipo"]) => `${listaId}-grupo-${tipo}`;

  const [termo, setTermo] = useState("");
  const [grupos, setGrupos] = useState<GrupoBusca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscou, setBuscou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);

  // Lista achatada: a navegação por teclado percorre os resultados na ordem em
  // que aparecem na tela, atravessando os títulos de grupo.
  const opcoes = grupos.flatMap((grupo) =>
    grupo.itens.map((item) => ({ ...item, tipo: grupo.tipo })),
  );

  /**
   * Cada digitação invalida a resposta anterior. Sem este contador, uma resposta
   * lenta de um termo já apagado poderia sobrescrever a lista do termo atual.
   */
  const requisicaoAtual = useRef(0);

  useEffect(() => {
    const consulta = termo.trim();

    if (consulta.length < MINIMO_CARACTERES) {
      requisicaoAtual.current += 1;
      setGrupos([]);
      setErro(null);
      setBuscou(false);
      setCarregando(false);
      setAtivo(-1);
      return;
    }

    const id = ++requisicaoAtual.current;
    setCarregando(true);

    const temporizador = setTimeout(async () => {
      try {
        const dados = await api.get<RespostaBusca>(
          `/api/search${queryString({ q: consulta })}`,
        );
        if (requisicaoAtual.current !== id) return;
        setGrupos(dados.grupos);
        setErro(null);
        setBuscou(true);
        setAtivo(-1);
      } catch (error) {
        if (requisicaoAtual.current !== id) return;
        setGrupos([]);
        setBuscou(true);
        setErro(
          error instanceof ApiError
            ? error.message
            : "Não foi possível buscar agora. Tente novamente.",
        );
      } finally {
        if (requisicaoAtual.current === id) setCarregando(false);
      }
    }, ATRASO_DIGITACAO_MS);

    return () => clearTimeout(temporizador);
  }, [termo]);

  function aoTeclar(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === "Escape") {
      setAberto(false);
      setAtivo(-1);
      return;
    }

    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      if (opcoes.length === 0) return;
      evento.preventDefault();
      setAberto(true);
      setAtivo((atual) => {
        const passo = evento.key === "ArrowDown" ? 1 : -1;
        const proximo = atual + passo;
        // Rotaciona nas pontas: quem chega ao fim da lista volta ao topo.
        if (proximo < 0) return opcoes.length - 1;
        if (proximo >= opcoes.length) return 0;
        return proximo;
      });
      return;
    }

    if (evento.key === "Home" && opcoes.length > 0) {
      evento.preventDefault();
      setAtivo(0);
      return;
    }

    if (evento.key === "End" && opcoes.length > 0) {
      evento.preventDefault();
      setAtivo(opcoes.length - 1);
      return;
    }

    if (evento.key === "Enter") {
      const escolhido = opcoes[ativo];
      if (!escolhido) return;
      evento.preventDefault();
      setAberto(false);
      router.push(escolhido.href);
    }
  }

  // O painel continua visível durante a busca: escondê-lo a cada tecla faria a
  // lista piscar no meio da digitação.
  const mostrarPainel = aberto && termo.trim().length >= MINIMO_CARACTERES;
  const semResultados = !carregando && buscou && !erro && opcoes.length === 0;

  // O foco nunca sai do campo (é `aria-activedescendant` que move a seleção),
  // então o navegador não rola o painel sozinho: sem isto, a opção "ativa" some
  // da área visível assim que a lista passa da altura máxima.
  useEffect(() => {
    if (ativo < 0) return;
    document
      .getElementById(opcaoId(ativo))
      ?.scrollIntoView({ block: "nearest" });
    // `opcaoId` deriva só de `listaId`, que é estável durante a vida do componente.
  }, [ativo, listaId]);

  return (
    <div
      className="relative"
      onBlur={(evento) => {
        // Só fecha quando o foco sai de vez do conjunto campo + resultados.
        if (!evento.currentTarget.contains(evento.relatedTarget)) {
          setAberto(false);
        }
      }}
    >
      <TextField
        label="Buscar em todo o sistema"
        type="search"
        role="combobox"
        autoComplete="off"
        placeholder="Reserva, kit, notebook, ocorrência ou pessoa"
        hint="Digite ao menos 2 caracteres. Use as setas para percorrer os resultados e Enter para abrir."
        value={termo}
        onChange={(evento) => {
          setTermo(evento.target.value);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onKeyDown={aoTeclar}
        aria-expanded={mostrarPainel}
        aria-controls={mostrarPainel ? listaId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={ativo >= 0 ? opcaoId(ativo) : undefined}
      />

      {/* Resultado e falha anunciados por leitor de tela sem depender de foco.
          O "carregando" fica por conta do `Spinner`, que já é `role="status"` —
          repeti-lo aqui faria a leitura dobrada a cada tecla. */}
      <p aria-live="polite" className="sr-only">
        {carregando
          ? ""
          : erro
            ? `A busca falhou: ${erro}`
            : buscou
              ? `${opcoes.length} resultado(s) para ${termo.trim()}.`
              : ""}
      </p>

      {mostrarPainel && (
        <div className="absolute z-20 mt-2 max-h-96 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          {/* Mensagens de estado ficam FORA da `listbox`: um `role="listbox"`
              só pode conter opções e grupos, e um parágrafo solto ali faz o
              leitor de tela perder a contagem de itens. */}
          {carregando && (
            <div className="px-3 py-2">
              <Spinner label="Buscando..." />
            </div>
          )}

          {!carregando && erro && (
            <p className="flex gap-2 px-3 py-2 text-sm font-medium text-red-700">
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
              <span>{erro}</span>
            </p>
          )}

          {semResultados && (
            <p className="px-3 py-2 text-sm text-slate-600">
              Nada encontrado para “{termo.trim()}”. Tente o código da reserva, o
              patrimônio do notebook ou o nome do professor.
            </p>
          )}

          {!carregando && !erro && opcoes.length > 0 && (
            <p className="px-3 pt-1 pb-2 text-xs text-slate-500">
              {opcoes.length} resultado(s)
            </p>
          )}

          <ul
            id={listaId}
            role="listbox"
            aria-label="Resultados da busca"
            className="flex flex-col gap-1"
          >
            {!carregando &&
              grupos.map((grupo) => (
                // `role="presentation"` some da árvore de acessibilidade e
                // "promove" o grupo a filho direto da listbox, como a ARIA exige.
                <li key={grupo.tipo} role="presentation">
                  <p
                    id={grupoId(grupo.tipo)}
                    className="px-3 py-1 text-xs font-semibold tracking-wide text-slate-500 uppercase"
                  >
                    {(() => {
                      const Icone = ICONE_GRUPO[grupo.tipo];
                      return (
                        <Icone
                          aria-hidden="true"
                          className="size-4 shrink-0 text-slate-400"
                        />
                      );
                    })()}
                    {grupo.rotulo}
                  </p>
                  <ul role="group" aria-labelledby={grupoId(grupo.tipo)}>
                    {grupo.itens.map((item) => {
                      const indice = opcoes.findIndex(
                        (opcao) =>
                          opcao.tipo === grupo.tipo && opcao.id === item.id,
                      );
                      const selecionado = indice === ativo;
                      return (
                        <li key={`${grupo.tipo}-${item.id}`} role="presentation">
                          <Link
                            id={opcaoId(indice)}
                            role="option"
                            aria-selected={selecionado}
                            href={item.href}
                            onMouseEnter={() => setAtivo(indice)}
                            onClick={() => setAberto(false)}
                            className={cn(
                              "flex min-h-11 flex-col justify-center rounded-lg px-3 py-2",
                              // Sublinhado e fundo juntos: quem não distingue
                              // cores continua vendo qual opção está ativa.
                              selecionado
                                ? "bg-senai-50 text-senai-900 underline underline-offset-2"
                                : "text-slate-800 hover:bg-slate-100",
                            )}
                          >
                            <span className="truncate text-sm font-medium">
                              {item.titulo}
                            </span>
                            {item.subtitulo && (
                              <span className="truncate text-xs text-slate-600">
                                {item.subtitulo}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
