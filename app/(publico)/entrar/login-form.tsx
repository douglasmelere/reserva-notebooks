"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api-client";
import { loginSchema } from "@/lib/validation";

/** Só os campos da resposta que a tela realmente usa. */
type LoginResponse = {
  usuario: { mustChangePassword: boolean };
};

type ErroGeral = { codigo: string; mensagem: string };

/** Converte os erros do Zod para o mesmo formato que a API devolve. */
function errosPorCampo(erro: z.ZodError): Record<string, string[]> {
  const campos: Record<string, string[]> = {};
  for (const issue of erro.issues) {
    const chave = issue.path.join(".") || "_";
    (campos[chave] ??= []).push(issue.message);
  }
  return campos;
}

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroGeral | null>(null);
  const [campos, setCampos] = useState<Record<string, string[]>>({});

  const avisoRef = useRef<HTMLDivElement>(null);

  // Leva o foco ao aviso quando ele aparece: sem isso, quem navega por teclado
  // ou leitor de tela continua no botão e não percebe por que nada aconteceu.
  useEffect(() => {
    if (erro) avisoRef.current?.focus();
  }, [erro]);

  async function entrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setCampos({});

    // Mesmo esquema usado pela rota: o que passa aqui passa lá.
    const analise = loginSchema.safeParse({ username, password });
    if (!analise.success) {
      setCampos(errosPorCampo(analise.error));
      // O aviso geral também é preenchido aqui, e não só nas falhas vindas da
      // API: marcar apenas os campos deixaria o clique em "Entrar" sem nenhuma
      // resposta anunciada nem foco movido, e quem usa teclado ou leitor de
      // tela ficaria parado no botão sem saber que faltou preencher algo.
      setErro({
        codigo: "DADOS_INVALIDOS",
        mensagem: "Confira os campos destacados abaixo.",
      });
      return;
    }

    setEnviando(true);
    try {
      const resposta = await api.post<LoginResponse>(
        "/api/auth/login",
        analise.data,
      );

      // Navegação completa (e não do roteador): o layout que decide o que
      // mostrar é Server Component e só enxerga a sessão nova em uma nova
      // requisição ao servidor.
      window.location.href = resposta.usuario.mustChangePassword
        ? "/perfil"
        : "/inicio";
      // `enviando` continua verdadeiro de propósito — a página está saindo, e
      // reabilitar o botão só convidaria a um segundo envio.
    } catch (causa) {
      if (causa instanceof ApiError) {
        setCampos(causa.fieldErrors);
        setErro({ codigo: causa.code, mensagem: causa.message });
      } else {
        setErro({
          codigo: "ERRO_INTERNO",
          mensagem: "Não foi possível entrar agora. Tente novamente em instantes.",
        });
      }
      setEnviando(false);
    }
  }

  const bloqueadoPorTentativas = erro?.codigo === "MUITAS_TENTATIVAS";

  return (
    <form onSubmit={entrar} noValidate className="flex flex-col gap-4">
      {/* O contêiner só existe quando há aviso: como item de um flex com
          `gap-4`, um <div> vazio ainda somaria um espaço de 1rem acima do
          primeiro campo, sem nada que o explicasse na tela. */}
      {erro && (
        <div ref={avisoRef} tabIndex={-1} className="focus:outline-none">
          {bloqueadoPorTentativas ? (
            <Alert tone="warning" title="Muitas tentativas seguidas">
              <p>{erro.mensagem}</p>
              <p className="mt-1">
                O bloqueio é temporário e automático: sua conta continua ativa e
                nada precisa ser feito pela supervisão. Assim que o tempo passar,
                tente de novo com calma.
              </p>
            </Alert>
          ) : (
            <Alert tone="danger" title="Não foi possível entrar">
              {erro.mensagem}
            </Alert>
          )}
        </div>
      )}

      <TextField
        label="Usuário da intranet"
        name="username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        error={campos.username}
        hint="O mesmo nome de usuário que você digita na intranet."
      />

      <TextField
        label="Senha"
        name="password"
        type={mostrarSenha ? "text" : "password"}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        required
        error={campos.password}
        hint="A mesma senha da intranet."
      />

      <CheckboxField
        label="Mostrar senha"
        checked={mostrarSenha}
        onChange={(event) => setMostrarSenha(event.target.checked)}
        hint="Útil para conferir a digitação no celular."
      />

      <Button type="submit" loading={enviando} fullWidth size="lg">
        {enviando ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
