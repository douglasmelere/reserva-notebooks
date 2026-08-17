import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { getEnv } from "./env";
import { AppError } from "./errors";

/**
 * Armazenamento de anexos das ocorrências.
 *
 * Duas implementações atrás da mesma interface:
 *  - `s3`: recomendada em produção. Os binários ficam fora do container, então
 *    trocar de imagem, escalar réplicas ou refazer o deploy não perde arquivo.
 *  - `local`: grava em um volume persistente. Simples para começar, mas exige
 *    que o volume seja declarado no Coolify — sem isso, os anexos somem no
 *    próximo deploy.
 *
 * O S3 é falado direto por HTTP com assinatura SigV4 (~80 linhas) em vez do
 * SDK da AWS: evita ~20 MB de dependência na imagem para três operações.
 */

export type StoredObject = {
  key: string;
  size: number;
  contentType: string;
};

export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** URL temporária de leitura, quando o driver suportar. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Validação de upload
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Assinaturas de arquivo ("magic bytes").
 *
 * O `Content-Type` enviado pelo navegador é apenas uma sugestão: quem envia
 * escolhe o valor. Conferimos os primeiros bytes para garantir que o arquivo é
 * mesmo uma imagem, e não um script com extensão trocada.
 */
function detectImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateUpload(
  fileName: string,
  declaredMime: string,
  buffer: Buffer,
): { mimeType: string; extension: string; safeName: string } {
  if (buffer.length === 0) {
    throw new AppError("DADOS_INVALIDOS", "O arquivo enviado está vazio.");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError(
      "DADOS_INVALIDOS",
      `O arquivo excede o limite de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  }

  const detected = detectImageType(buffer);
  if (!detected || !ALLOWED_MIME[detected]) {
    throw new AppError(
      "DADOS_INVALIDOS",
      "Formato não aceito. Envie uma imagem JPG, PNG ou WEBP.",
    );
  }
  if (declaredMime && declaredMime !== detected) {
    throw new AppError(
      "DADOS_INVALIDOS",
      "O conteúdo do arquivo não corresponde ao tipo informado.",
    );
  }

  // Nome saneado: só serve para o download; a chave real é gerada pelo sistema.
  const safeName =
    fileName
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || `anexo.${ALLOWED_MIME[detected]}`;

  return { mimeType: detected, extension: ALLOWED_MIME[detected]!, safeName };
}

export function buildAttachmentKey(incidentId: string, extension: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `ocorrencias/${yyyy}/${mm}/${incidentId}/${randomUUID()}.${extension}`;
}

// ---------------------------------------------------------------------------
// Volume local
// ---------------------------------------------------------------------------

class LocalDiskStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  /** Impede que uma chave manipulada escape do diretório de uploads. */
  private resolveKey(key: string): string {
    const target = resolve(join(this.root, normalize(key)));
    const rootResolved = resolve(this.root);
    if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
      throw new AppError("DADOS_INVALIDOS", "Caminho de arquivo inválido.");
    }
    return target;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    // O tipo fica ao lado do arquivo: o disco não guarda metadados HTTP.
    await writeFile(`${path}.type`, contentType, "utf8");
    return { key, size: body.length, contentType };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const path = this.resolveKey(key);
    try {
      const body = await readFile(path);
      const contentType = await readFile(`${path}.type`, "utf8").catch(
        () => "application/octet-stream",
      );
      return { body, contentType: contentType.trim() };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.resolveKey(key);
    await unlink(path).catch(() => undefined);
    await unlink(`${path}.type`).catch(() => undefined);
  }

  async signedUrl(): Promise<string | null> {
    // Sem URL direta: o arquivo é servido pela própria aplicação, que aplica
    // a verificação de permissão antes de entregar o conteúdo.
    return null;
  }
}

// ---------------------------------------------------------------------------
// S3 (SigV4)
// ---------------------------------------------------------------------------

const sha256Hex = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest();

function amzDate(date: Date): { full: string; short: string } {
  const full = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { full, short: full.slice(0, 8) };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeS3Key(key: string): string {
  return key.split("/").map(encodeRfc3986).join("/");
}

type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

class S3Storage implements StorageAdapter {
  constructor(private readonly config: S3Config) {}

  private objectUrl(key: string): { url: URL; host: string } {
    const base = new URL(this.config.endpoint);
    const encodedKey = encodeS3Key(key);
    const url = this.config.forcePathStyle
      ? new URL(`${base.origin}/${this.config.bucket}/${encodedKey}`)
      : new URL(
          `${base.protocol}//${this.config.bucket}.${base.host}/${encodedKey}`,
        );
    return { url, host: url.host };
  }

  private signingKey(shortDate: string): Buffer {
    return hmac(
      hmac(
        hmac(hmac(`AWS4${this.config.secretAccessKey}`, shortDate), this.config.region),
        "s3",
      ),
      "aws4_request",
    );
  }

  /** Assinatura no cabeçalho `Authorization` (usada em PUT/GET/DELETE). */
  private sign(
    method: string,
    key: string,
    payloadHash: string,
    extraHeaders: Record<string, string> = {},
  ): { url: URL; headers: Record<string, string> } {
    const { url, host } = this.objectUrl(key);
    const now = new Date();
    const { full, short } = amzDate(now);

    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": full,
      ...extraHeaders,
    };

    const sortedNames = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort();
    const canonicalHeaders = sortedNames
      .map((name) => {
        const value = Object.entries(headers).find(
          ([k]) => k.toLowerCase() === name,
        )![1];
        return `${name}:${String(value).trim()}\n`;
      })
      .join("");
    const signedHeaders = sortedNames.join(";");

    const canonicalRequest = [
      method,
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${short}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      full,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signature = createHmac("sha256", this.signingKey(short))
      .update(stringToSign)
      .digest("hex");

    return {
      url,
      headers: {
        ...headers,
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const { url, headers } = this.sign("PUT", key, sha256Hex(body), {
      "content-type": contentType,
    });

    // `fetch` aceita Uint8Array; Buffer é subclasse, mas os tipos do DOM não
    // reconhecem a assinatura diretamente.
    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: new Uint8Array(body),
    });
    if (!response.ok) {
      throw new AppError(
        "ERRO_INTERNO",
        "Falha ao enviar o arquivo para o armazenamento.",
        { cause: new Error(`S3 PUT ${response.status}`) },
      );
    }
    return { key, size: body.length, contentType };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const { url, headers } = this.sign("GET", key, sha256Hex(""));
    const response = await fetch(url, { method: "GET", headers });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new AppError("ERRO_INTERNO", "Falha ao ler o arquivo armazenado.", {
        cause: new Error(`S3 GET ${response.status}`),
      });
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    const { url, headers } = this.sign("DELETE", key, sha256Hex(""));
    await fetch(url, { method: "DELETE", headers });
  }

  /** URL pré-assinada por query string, para leitura direta pelo navegador. */
  async signedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const { url, host } = this.objectUrl(key);
    const now = new Date();
    const { full, short } = amzDate(now);
    const scope = `${short}/${this.config.region}/s3/aws4_request`;

    const params = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.config.accessKeyId}/${scope}`,
      "X-Amz-Date": full,
      "X-Amz-Expires": String(expiresInSeconds),
      "X-Amz-SignedHeaders": "host",
    });
    // A query canônica precisa estar ordenada por nome do parâmetro.
    params.sort();

    const canonicalRequest = [
      "GET",
      url.pathname,
      params.toString(),
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      full,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signature = createHmac("sha256", this.signingKey(short))
      .update(stringToSign)
      .digest("hex");

    params.append("X-Amz-Signature", signature);
    return `${url.origin}${url.pathname}?${params.toString()}`;
  }
}

// ---------------------------------------------------------------------------

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (adapter) return adapter;
  const env = getEnv();

  if (env.STORAGE_DRIVER === "s3") {
    adapter = new S3Storage({
      endpoint: env.S3_ENDPOINT ?? `https://s3.${env.S3_REGION}.amazonaws.com`,
      region: env.S3_REGION!,
      bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: Boolean(env.S3_FORCE_PATH_STYLE),
    });
  } else {
    adapter = new LocalDiskStorage(env.STORAGE_LOCAL_PATH);
  }

  return adapter;
}

/** Usado nos testes para injetar um adaptador em memória. */
export function setStorageAdapter(next: StorageAdapter | null): void {
  adapter = next;
}
