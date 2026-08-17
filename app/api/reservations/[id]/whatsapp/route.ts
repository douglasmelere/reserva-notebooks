import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { requestWhatsappContact } from "@/server/whatsapp-contact";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Contato com quem está usando o equipamento.
 *
 * É POST — e não GET — porque gerar o link registra um evento de acesso a dado
 * pessoal (`whatsapp_contact_logs`). Nada da reserva é alterado: a negociação
 * acontece entre os docentes, fora do sistema.
 *
 * Corpo vazio: o alvo é a reserva da URL.
 */
export const POST = handle(async (_request: Request, { params }: RouteContext) => {
  const user = await requireUser();
  await assertSameOrigin();
  const { id } = await params;

  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  // Sem telefone autorizado a resposta é 200 com `disponivel: false` e uma
  // orientação: para o professor que consulta, isso não é falha, é o caminho a
  // seguir (procurar a supervisão).
  const result = await requestWhatsappContact(id, user, { ip, userAgent });
  return json(result);
}, "reservas.contato-whatsapp");
