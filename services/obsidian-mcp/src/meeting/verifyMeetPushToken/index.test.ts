import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyMeetPushToken } from "./index.ts";

const AUDIENCE = "https://mcp.example.studio/meet/webhook";
const SERVICE_ACCOUNT = "meet-push@my-project.iam.gserviceaccount.com";

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let getKey: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  getKey = createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256", use: "sig" }] });
});

const mint = (claims: Record<string, unknown>, opts?: { audience?: string; issuer?: string }) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(opts?.issuer ?? "https://accounts.google.com")
    .setAudience(opts?.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

describe("verifyMeetPushToken", () => {
  it("accepts a token from the configured push service account", async () => {
    const token = await mint({ email: SERVICE_ACCOUNT, email_verified: true });
    const ok = await verifyMeetPushToken(`Bearer ${token}`, {
      audience: AUDIENCE,
      serviceAccount: SERVICE_ACCOUNT,
      getKey,
    });
    expect(ok).toBe(true);
  });

  it("rejects a token for a different audience", async () => {
    const token = await mint(
      { email: SERVICE_ACCOUNT, email_verified: true },
      { audience: "https://elsewhere.example" },
    );
    const ok = await verifyMeetPushToken(`Bearer ${token}`, {
      audience: AUDIENCE,
      serviceAccount: SERVICE_ACCOUNT,
      getKey,
    });
    expect(ok).toBe(false);
  });

  it("rejects a token from a different service account", async () => {
    const token = await mint({ email: "intruder@evil.example", email_verified: true });
    const ok = await verifyMeetPushToken(`Bearer ${token}`, {
      audience: AUDIENCE,
      serviceAccount: SERVICE_ACCOUNT,
      getKey,
    });
    expect(ok).toBe(false);
  });

  it("rejects a token without a verified email claim", async () => {
    const token = await mint({ email: SERVICE_ACCOUNT });
    const ok = await verifyMeetPushToken(`Bearer ${token}`, {
      audience: AUDIENCE,
      serviceAccount: SERVICE_ACCOUNT,
      getKey,
    });
    expect(ok).toBe(false);
  });

  it("rejects a missing or malformed Authorization header", async () => {
    const opts = { audience: AUDIENCE, serviceAccount: SERVICE_ACCOUNT, getKey };
    expect(await verifyMeetPushToken(undefined, opts)).toBe(false);
    expect(await verifyMeetPushToken("Token abc", opts)).toBe(false);
    expect(await verifyMeetPushToken("Bearer ", opts)).toBe(false);
    expect(await verifyMeetPushToken("Bearer not-a-jwt", opts)).toBe(false);
  });
});
