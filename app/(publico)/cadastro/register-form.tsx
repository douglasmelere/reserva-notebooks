"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api-client";
import { registerSchema } from "@/lib/validation";

type ErroGeral = { codigo: string; mensagem: string };

/**
 * Campo opcional em branco é ausente, não vazio.
 *
 * O esquema valida formato antes de tratar o vazio: mandar `""` em e-mail ou
 * telefone reprovaria por "formato inválido" um campo que o professor apenas
 * não quis preencher.
 */
function opcional(valor: string): string | undefined {
  return valor.trim() === "" ? undefined : valor;
}

/** Converte os erros do Zod para o mesmo formato que a API devolve. */
function errosPorCampo(erro: z.ZodError): Record<string, string[]> {
  const campos: Record<string, string[]> = {};
  for (const issue of erro.issues) {
    const chave = issue.path.join(".") || "_";
    (campos[chave] ??= []).push(issue.message);
  }
  return campos;
}

export function RegisterForm() {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroGeral | null>(null);
  const [campos, setCampos] = useState<Record<string, string[]>>({});
  /** Conta criada, mas a entrada automática não funcionou. */
  const [concluidoSemEntrar, setConcluidoSemEntrar] = useState(false);

  const avisoRef = useRef<HTMLDivElement>(null);

  // O aviso recebe o foco ao aparecer, para quem usa teclado ou leitor de tela
  // não ficar preso no fim do formulário sem saber o que deu errado.
  useEffect(() => {
    if (erro) avisoRef.current?.focus();
  }, [erro]);

  const temTelefone = phone.trim() !== "";

  function alterarTelefone(valor: string) {
    setPhone(valor);
    // Sem número não há como contatar: manter a autorização marcada seria uma
    // promessa vazia na tela.
    if (valor.trim() === "") setWhatsappOptIn(false);
  }

  async function cadastrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setCampos({});

    // Mesmo esquema da rota; a confirmação de senha é conferida só aqui porque
    // a API não recebe esse campo.
    const analise = registerSchema.safeParse({
      fullName,
      username,
      password,
      email: opcional(email),
      phone: opcional(phone),
      department: opcional(department),
      whatsappOptIn,
    });

    const problemas: Record<string, string[]> = analise.success
      ? {}
      : errosPorCampo(analise.error);
    if (password !== confirmPassword) {
      problemas.confirmPassword = ["As duas senhas não são iguais."];
    }
    if (Object.keys(problemas).length > 0) {
      setCampos(problemas);
      setErro({
        codigo: "DADOS_INVALIDOS",
        mensagem: "Confira os campos destacados abaixo.",
      });
      return;
    }
    if (!analise.success) return; // inalcançável; estreita o tipo para o TypeScript

    const dados = analise.data;
    setEnviando(true);

    try {
      await api.post("/api/auth/register", dados);
    } catch (causa) {
      if (causa instanceof ApiError) {
        setCampos(causa.fieldErrors);
        setErro({ codigo: causa.code, mensagem: causa.message });
      } else {
        setErro({
          codigo: "ERRO_INTERNO",
          mensagem:
            "Não foi possível concluir o cadastro agora. Tente novamente em instantes.",
        });
      }
      setEnviando(false);
      return;
    }

    // A conta já existe a partir daqui. Se a entrada automática falhar (rede,
    // limite de tentativas do IP), o erro não pode sugerir "cadastre de novo".
    try {
      await api.post("/api/auth/login", {
        username: dados.username,
        password: dados.password,
      });
      // Navegação completa para o servidor renderizar a área autenticada já
      // com a sessão recém-criada.
      window.location.href = "/inicio";
    } catch {
      setConcluidoSemEntrar(true);
      setEnviando(false);
    }
  }

  if (concluidoSemEntrar) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title="Cadastro concluído">
          Sua conta foi criada, mas não conseguimos entrar automaticamente.
          Acesse a tela de entrada e informe o usuário e a senha que você acabou
          de cadastrar.
        </Alert>
        <Link
          href="/entrar"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-700 px-5 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        >
          Ir para a tela de entrada
        </Link>
      </div>
    );
  }

  // Evita repetir a mesma frase no aviso geral e no campo destacado.
  const mensagemJaNoCampo =
    erro !== null &&
    Object.values(campos).some((lista) => lista.includes(erro.mensagem));

  return (
    <form onSubmit={cadastrar} noValidate className="flex flex-col gap-4">
      <div ref={avisoRef} tabIndex={-1} className="focus:outline-none">
        {erro && (
          <Alert tone="danger" title="Não foi possível concluir o cadastro">
            {mensagemJaNoCampo
              ? "Confira os campos destacados abaixo."
              : erro.mensagem}
          </Alert>
        )}
      </div>

      <TextField
        label="Nome completo"
        name="fullName"
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        autoComplete="name"
        required
        error={campos.fullName}
        hint="Como você quer ser identificado nas reservas."
      />

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
        hint="Use apenas letras, números, ponto, hífen e sublinhado."
      />

      <TextField
        label="Senha"
        name="password"
        type={mostrarSenha ? "text" : "password"}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        required
        error={campos.password}
        hint="Ao menos 8 caracteres."
      />

      <TextField
        label="Confirme a senha"
        name="confirmPassword"
        type={mostrarSenha ? "text" : "password"}
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        autoComplete="new-password"
        required
        error={campos.confirmPassword}
        hint="Digite a mesma senha outra vez."
      />

      <CheckboxField
        label="Mostrar as senhas"
        checked={mostrarSenha}
        onChange={(event) => setMostrarSenha(event.target.checked)}
        hint="Útil para conferir a digitação no celular."
      />

      <TextField
        label="E-mail institucional (opcional)"
        name="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        error={campos.email}
        hint="Ajuda a supervisão a identificar você. Não é usado para entrar."
      />

      <TextField
        label="Telefone / WhatsApp (opcional)"
        name="phone"
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(event) => alterarTelefone(event.target.value)}
        autoComplete="tel"
        error={campos.phone}
        hint="Com DDD, por exemplo: (48) 99999-8888."
      />

      <TextField
        label="Departamento ou disciplina (opcional)"
        name="department"
        value={department}
        onChange={(event) => setDepartment(event.target.value)}
        error={campos.department}
        hint="Por exemplo: Matemática, Coordenação do Ensino Fundamental."
      />

      <CheckboxField
        label="Autorizo ser contatado por WhatsApp sobre equipamentos que eu reservei"
        checked={whatsappOptIn}
        disabled={!temTelefone}
        onChange={(event) => setWhatsappOptIn(event.target.checked)}
        error={campos.whatsappOptIn}
        hint={
          temTelefone ? (
            <>
              Quando outro professor precisar de um equipamento que você
              reservou, o sistema abre para ele uma conversa de WhatsApp com
              você, já com a mensagem escrita — quem envia é ele, não o sistema.
              Seu número não aparece na tela de ninguém. Você pode desmarcar
              esta autorização quando quiser em <strong>Meu perfil</strong>.
            </>
          ) : (
            "Preencha o telefone acima para poder autorizar. Sem número não há como iniciar a conversa."
          )
        }
      />

      <Button type="submit" loading={enviando} fullWidth size="lg">
        {enviando ? "Criando cadastro..." : "Criar cadastro e entrar"}
      </Button>
    </form>
  );
}
