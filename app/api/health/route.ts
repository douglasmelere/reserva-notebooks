import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  let database: "ok" | "erro" = "ok";
  let databaseError: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "erro";
    databaseError = error instanceof Error ? error.name : "erro desconhecido";
  }

  const healthy = database === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "degradado",
      database,
      databaseError,
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
