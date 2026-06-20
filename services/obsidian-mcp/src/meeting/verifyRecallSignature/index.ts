import { createHmac, timingSafeEqual } from "node:crypto";

export interface SvixHeaders {
  readonly svixId?: string;
  readonly svixTimestamp?: string;
  readonly svixSignature?: string;
}

/**
 * Verify a Recall.ai webhook signature. Recall delivers webhooks via Svix,
 * which signs `${id}.${timestamp}.${body}` with HMAC-SHA256 under the
 * base64 key embedded in the `whsec_...` secret and base64-encodes the
 * result. The `svix-signature` header carries one or more space-separated
 * `v1,<sig>` entries; the request is authentic if any entry matches.
 *
 * Pure + unit-tested so the signing scheme is verifiable without the
 * network. Returns false on any missing header or mismatch.
 *
 * @param headers The svix-id / svix-timestamp / svix-signature headers.
 * @param rawBody The exact request body bytes as a string (pre-parse).
 * @param secret  The Svix signing secret (`whsec_...`).
 */
export const verifyRecallSignature = (
  headers: SvixHeaders,
  rawBody: string,
  secret: string,
  opts?: { readonly toleranceSeconds?: number; readonly nowMs?: number },
): boolean => {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Replay guard: reject timestamps outside a tolerance window (Svix's
  // default is 5 minutes). The timestamp is also folded into the signed
  // content below, so a forged one can't pass the HMAC — this bounds replay
  // of a *captured* valid request.
  const toleranceSeconds = opts?.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;

  const keyMaterial = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const keyBytes = Buffer.from(keyMaterial, "base64");
  if (keyBytes.length === 0) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", keyBytes).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected, "utf8");

  for (const entry of svixSignature.split(" ")) {
    const comma = entry.indexOf(",");
    const provided = comma >= 0 ? entry.slice(comma + 1) : entry;
    const providedBuf = Buffer.from(provided, "utf8");
    if (providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
};
