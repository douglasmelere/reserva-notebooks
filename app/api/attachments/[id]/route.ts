import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getAttachment } from "@/server/incidents";

export const dynamic = "force-dynamic";

/** Nome ASCII de reserva para clientes antigos que ignoram `filename*`. */
function asciiFallback(fileName: string): string {
  return fileName.replace(/[^\w.\- ]+/g, "_") || "anexo";
}

/**
 * Entrega o binário do anexo.
 *
 * O arquivo é servido pela aplicação, e não por uma URL pública do storage,
 * porque a permissão precisa ser verificada a cada leitura — uma foto de
 * equipamento danificado com o nome do docente ao lado não pode ficar acessível
 * a quem tiver o link. Por isso também o cache é `private`: pode ficar no
 * navegador de quem abriu, nunca em um proxy compartilhado.
 */
export const GET = handle(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireUser();
    const { id } = await params;

    const anexo = await getAttachment(id, actor);

    return new Response(new Uint8Array(anexo.body), {
      status: 200,
      headers: {
        "content-type": anexo.mimeType,
        "content-length": String(anexo.body.byteLength),
        "content-disposition":
          `inline; filename="${asciiFallback(anexo.fileName)}"; ` +
          `filename*=UTF-8''${encodeURIComponent(anexo.fileName)}`,
        "cache-control": "private, max-age=300, must-revalidate",
        // O tipo é o detectado pelos bytes no upload; impedir a adivinhação do
        // navegador fecha a porta para um arquivo que se disfarça de imagem.
        "x-content-type-options": "nosniff",
      },
    });
  },
  "anexos.baixar",
);
