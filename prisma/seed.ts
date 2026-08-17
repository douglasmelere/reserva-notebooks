/**
 * Dados de desenvolvimento.
 *
 * Popula o banco com um cenário pequeno mas realista, suficiente para navegar
 * por todas as telas: dois tipos de kit, notebooks distribuídos, um kit de
 * carregadores completo e outro incompleto, reservas em estados diferentes e
 * uma ocorrência aberta.
 *
 * Nada aqui é segredo: as senhas são visíveis de propósito, porque são de
 * mentira. Por isso mesmo o script se recusa a rodar com NODE_ENV=production,
 * a menos que a intenção seja declarada explicitamente.
 *
 *   npm run db:seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/password.js";
import { reservationInterval, todayLocal, addDays } from "../src/lib/datetime.js";
import { kitKey, notebookKey } from "../src/server/resources.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Variáveis já podem vir do ambiente (docker compose, Coolify).
}

const TZ = process.env.INSTITUTION_TIMEZONE ?? "America/Sao_Paulo";

/** Senha única para todas as contas fictícias. Ambiente de desenvolvimento. */
const SENHA_DEMO = "senha-de-teste-123";

function guardaProducao(): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_SEED_IN_PRODUCTION !== "sim-eu-tenho-certeza"
  ) {
    console.error(
      "\n  Recusando rodar o seed com NODE_ENV=production.\n" +
        "  Ele cria contas de demonstração com senha conhecida.\n" +
        "  Em produção, use: npm run bootstrap:admin\n",
    );
    process.exit(1);
  }
}

async function main() {
  guardaProducao();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada.");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  console.log("Limpando dados anteriores de demonstração...");
  // Ordem inversa das dependências. Nas relações com onDelete: Cascade o banco
  // já cuidaria, mas ser explícito deixa o script legível e previsível.
  await prisma.whatsappContactLog.deleteMany();
  await prisma.incidentAttachment.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.reservationItem.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.session.deleteMany();
  await prisma.notebook.deleteMany();
  await prisma.chargerKit.deleteMany();
  await prisma.kit.deleteMany();
  await prisma.user.deleteMany();
  await prisma.systemSetting.deleteMany();

  const passwordHash = await hashPassword(SENHA_DEMO);

  // --- Usuários ------------------------------------------------------------
  console.log("Criando usuários...");
  const supervisor = await prisma.user.create({
    data: {
      username: "supervisao",
      passwordHash,
      fullName: "Marina Alves (Supervisão)",
      email: "supervisao@exemplo.edu.br",
      phone: "5548999990001",
      whatsappOptIn: true,
      department: "Coordenação de Tecnologia",
      role: "SUPERVISOR",
    },
  });

  const professores = await Promise.all(
    [
      {
        username: "prof.silva",
        fullName: "Carlos Silva",
        department: "Matemática",
        phone: "5548999990002",
        whatsappOptIn: true,
      },
      {
        username: "prof.souza",
        fullName: "Ana Souza",
        department: "História",
        phone: "5548999990003",
        // Sem autorização de WhatsApp de propósito: exercita o caminho em que
        // o botão de contato NÃO deve aparecer.
        whatsappOptIn: false,
      },
      {
        username: "prof.lima",
        fullName: "Roberto Lima",
        department: "Ciências",
        phone: null,
        whatsappOptIn: false,
      },
      {
        username: "prof.costa",
        fullName: "Juliana Costa",
        department: "Língua Portuguesa",
        phone: "5548999990005",
        whatsappOptIn: true,
      },
    ].map((p) =>
      prisma.user.create({
        data: {
          ...p,
          passwordHash,
          email: `${p.username.replace(".", "")}@exemplo.edu.br`,
          role: "PROFESSOR",
        },
      }),
    ),
  );

  const [silva, souza, , costa] = professores;

  // --- Kits ----------------------------------------------------------------
  console.log("Criando kits, notebooks e carregadores...");
  const maleta1 = await prisma.kit.create({
    data: {
      code: "MAL-001",
      name: "Maleta 01",
      type: "MALETA",
      capacity: 10,
      location: "Sala dos Professores",
      description: "Maleta com notebooks de 14 polegadas para uso em sala.",
      status: "DISPONIVEL",
    },
  });

  const maleta2 = await prisma.kit.create({
    data: {
      code: "MAL-002",
      name: "Maleta 02",
      type: "MALETA",
      capacity: 8,
      location: "Laboratório de Informática",
      status: "MANUTENCAO",
      notes: "Aguardando troca da fechadura.",
    },
  });

  const carrinhoA = await prisma.kit.create({
    data: {
      code: "CAR-A",
      name: "Carrinho A",
      type: "CARRINHO",
      capacity: 20,
      location: "Depósito do Bloco B",
      description: "Carrinho com tomadas internas para carga simultânea.",
      status: "DISPONIVEL",
    },
  });

  // Kit de carregadores completo e incompleto, para exercitar as duas telas.
  await prisma.chargerKit.create({
    data: {
      code: "CARG-MAL-001",
      kitId: maleta1.id,
      totalQuantity: 10,
      availableQuantity: 10,
      status: "COMPLETO",
    },
  });

  await prisma.chargerKit.create({
    data: {
      code: "CARG-CAR-A",
      kitId: carrinhoA.id,
      totalQuantity: 20,
      availableQuantity: 17,
      status: "INCOMPLETO",
      missingParts: "Faltam 3 fontes de 65W. Duas foram para manutenção.",
    },
  });

  // --- Notebooks -----------------------------------------------------------
  const criarNotebooks = (
    prefixo: string,
    quantidade: number,
    kitId: string | null,
    inicio = 1,
  ) =>
    Array.from({ length: quantidade }, (_, i) => ({
      assetTag: `${prefixo}-${String(inicio + i).padStart(3, "0")}`,
      serialNumber: `SN${prefixo}${String(inicio + i).padStart(5, "0")}`,
      brand: "Acme",
      model: "EduBook 14",
      kitId,
      status: "DISPONIVEL" as const,
    }));

  await prisma.notebook.createMany({
    data: [
      ...criarNotebooks("NB", 10, maleta1.id, 1),
      ...criarNotebooks("NB", 8, maleta2.id, 11),
      ...criarNotebooks("NB", 20, carrinhoA.id, 21),
      // Avulsos: não pertencem a nenhum kit e podem ser reservados sozinhos.
      ...criarNotebooks("AVL", 4, null, 1),
    ],
  });

  // Um notebook em manutenção: precisa sumir da disponibilidade.
  const emManutencao = await prisma.notebook.findFirst({
    where: { assetTag: "NB-003" },
  });
  if (emManutencao) {
    await prisma.notebook.update({
      where: { id: emManutencao.id },
      data: {
        status: "MANUTENCAO",
        notes: "Tela com listras verticais. Aguardando orçamento.",
      },
    });
  }

  const avulsos = await prisma.notebook.findMany({
    where: { kitId: null },
    orderBy: { assetTag: "asc" },
  });

  // --- Reservas ------------------------------------------------------------
  console.log("Criando reservas de exemplo...");
  const hoje = todayLocal(TZ);
  const amanha = addDays(hoje, 1);
  const depois = addDays(hoje, 3);
  const ontem = addDays(hoje, -1);

  type NovaReserva = {
    code: string;
    userId: string;
    date: string;
    inicio: string | null;
    fim: string | null;
    status:
      | "CONFIRMADA"
      | "EM_USO"
      | "ENCERRADA"
      | "CANCELADA";
    purpose: string;
    className: string;
    subject: string;
    room: string;
    recursos: { kitId?: string; notebookId?: string }[];
  };

  const reservas: NovaReserva[] = [
    {
      code: "RS-DEMO01",
      userId: silva!.id,
      date: amanha,
      inicio: "08:00",
      fim: "10:00",
      status: "CONFIRMADA",
      purpose: "Atividade de geometria com software de construção",
      className: "8º ano B",
      subject: "Matemática",
      room: "Sala 12",
      recursos: [{ kitId: maleta1.id }],
    },
    {
      code: "RS-DEMO02",
      userId: souza!.id,
      date: amanha,
      inicio: "13:30",
      fim: "15:30",
      status: "CONFIRMADA",
      purpose: "Pesquisa sobre period colonial",
      className: "1º ano A",
      subject: "História",
      room: "Laboratório 2",
      recursos: [{ kitId: carrinhoA.id }],
    },
    {
      code: "RS-DEMO03",
      userId: costa!.id,
      date: depois,
      inicio: "10:00",
      fim: "11:30",
      status: "CONFIRMADA",
      purpose: "Produção textual colaborativa",
      className: "2º ano C",
      subject: "Língua Portuguesa",
      room: "Sala 5",
      recursos: [
        { notebookId: avulsos[0]!.id },
        { notebookId: avulsos[1]!.id },
      ],
    },
    {
      code: "RS-DEMO04",
      userId: silva!.id,
      date: ontem,
      inicio: "09:00",
      fim: "11:00",
      status: "ENCERRADA",
      purpose: "Simulado online",
      className: "9º ano A",
      subject: "Matemática",
      room: "Sala 12",
      recursos: [{ kitId: maleta1.id }],
    },
  ];

  for (const r of reservas) {
    const { startsAt, endsAt, allDay, date } = reservationInterval(
      r.date,
      r.inicio,
      r.fim,
      TZ,
    );
    // Reserva encerrada não ocupa mais o recurso — é o que libera a agenda.
    const blocking = r.status === "CONFIRMADA" || r.status === "EM_USO";

    await prisma.reservation.create({
      data: {
        code: r.code,
        userId: r.userId,
        date,
        startsAt,
        endsAt,
        allDay,
        purpose: r.purpose,
        className: r.className,
        subject: r.subject,
        room: r.room,
        status: r.status,
        createdById: r.userId,
        ...(r.status === "ENCERRADA"
          ? { closedAt: endsAt, returnedAt: endsAt }
          : {}),
        items: {
          create: r.recursos.map((recurso) => ({
            type: recurso.kitId ? ("KIT" as const) : ("NOTEBOOK" as const),
            kitId: recurso.kitId ?? null,
            notebookId: recurso.notebookId ?? null,
            resourceKey: recurso.kitId
              ? kitKey(recurso.kitId)
              : notebookKey(recurso.notebookId!),
            startsAt,
            endsAt,
            blocking,
          })),
        },
      },
    });
  }

  // --- Ocorrência aberta ---------------------------------------------------
  console.log("Criando ocorrência de exemplo...");
  const notebookComProblema = await prisma.notebook.findFirst({
    where: { assetTag: "NB-003" },
  });

  if (notebookComProblema) {
    await prisma.incident.create({
      data: {
        code: "OC-DEMO01",
        targetType: "NOTEBOOK",
        notebookId: notebookComProblema.id,
        reportedById: silva!.id,
        assignedToId: supervisor.id,
        category: "TELA",
        severity: "ALTA",
        status: "ABERTA",
        description:
          "A tela apresenta listras verticais logo ao ligar. O problema aparece " +
          "mesmo com o notebook na tomada e piora ao mover a tampa.",
      },
    });
  }

  await prisma.incident.create({
    data: {
      code: "OC-DEMO02",
      targetType: "CHARGER_KIT",
      chargerKitId: (await prisma.chargerKit.findFirst({
        where: { code: "CARG-CAR-A" },
      }))!.id,
      reportedById: costa!.id,
      category: "CARREGADOR_FALTANTE",
      severity: "MEDIA",
      status: "EM_ANALISE",
      description:
        "Ao devolver o Carrinho A faltavam 3 fontes. Conferimos com a lista " +
        "afixada na tampa e realmente não estavam lá.",
    },
  });

  await prisma.$disconnect();

  console.log(`
Seed concluído.

  Supervisor:  supervisao      / ${SENHA_DEMO}
  Professores: prof.silva      / ${SENHA_DEMO}
               prof.souza      / ${SENHA_DEMO}   (sem WhatsApp autorizado)
               prof.lima       / ${SENHA_DEMO}   (sem telefone cadastrado)
               prof.costa      / ${SENHA_DEMO}

  Inventário:  Maleta 01 (10 notebooks, carregadores completos)
               Maleta 02 (8 notebooks, EM MANUTENÇÃO)
               Carrinho A (20 notebooks, 3 carregadores faltando)
               4 notebooks avulsos
               NB-003 em manutenção, com ocorrência aberta

  Estas contas são fictícias e a senha é pública. Nunca use em produção.
`);
}

main().catch((error) => {
  console.error("Falha ao executar o seed:", error);
  process.exit(1);
});
