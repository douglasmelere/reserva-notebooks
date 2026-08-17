import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { dadosInvalidos } from "@/lib/errors";
import { handle, json } from "@/lib/http";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { addAttachment } from "@/server/incidents";

export const dynamic = "force-dynamic";

/**
 * Folga para o envelope do multipart (limites, cabeçalhos de parte, nome do
 * arquivo). Serve só para a checagem antecipada de `content-length`; o limite
 * que vale é o dos bytes do arquivo, conferido depois.
 */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

const LIMITE_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

export const POST = handle(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireUser();
    await assertSameOrigin();

    const { id } = await params;

    // Recusa pelo cabeçalho antes de materializar o corpo: um envio de 500 MB
    // não deve ser lido inteiro na memória do container só para ser rejeitado.
    const declarado = Number(request.headers.get("content-length") ?? "");
    if (
      Number.isFinite(declarado) &&
      declarado > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES
    ) {
      throw dadosInvalidos(`O arquivo excede o limite de ${LIMITE_MB} MB.`);
    }

    const form = await request.formData();
    const arquivo = form.get("file");

    if (!(arquivo instanceof File)) {
      throw dadosInvalidos('Envie a imagem no campo "file" do formulário.');
    }
    // Segunda barreira: o `content-length` pode vir ausente ou mentiroso.
    if (arquivo.size > MAX_UPLOAD_BYTES) {
      throw dadosInvalidos(`O arquivo excede o limite de ${LIMITE_MB} MB.`);
    }

    const bytes = Buffer.from(await arquivo.arrayBuffer());
    const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

    const anexo = await addAttachment(
      id,
      { fileName: arquivo.name, mimeType: arquivo.type, bytes },
      actor,
      { ip, userAgent },
    );

    return json({ anexo }, { status: 201 });
  },
  "ocorrencias.anexar",
);
