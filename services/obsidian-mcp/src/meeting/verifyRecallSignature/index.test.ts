import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRecallSignature } from "./index.ts";

const secret = `whsec_${Buffer.from("super-secret-signing-key").toString("base64")}`;
const id = "msg_123";
const ts = String(Math.floor(Date.now() / 1000));
const body = '{"event":"bot.done","data":{"bot":{"id":"bot-1"}}}';

const sign = (s: string, msgId: string, timestamp: string, payload: string): string => {
  const key = Buffer.from(s.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${msgId}.${timestamp}.${payload}`).digest("base64");
};

describe("verifyRecallSignature", () => {
  it("accepts a correctly-signed payload", () => {
    const svixSignature = `v1,${sign(secret, id, ts, body)}`;
    expect(
      verifyRecallSignature({ svixId: id, svixTimestamp: ts, svixSignature }, body, secret),
    ).toBe(true);
  });

  it("accepts when multiple signatures are present", () => {
    const svixSignature = `v1,deadbeef v1,${sign(secret, id, ts, body)}`;
    expect(
      verifyRecallSignature({ svixId: id, svixTimestamp: ts, svixSignature }, body, secret),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const svixSignature = `v1,${sign(secret, id, ts, body)}`;
    expect(
      verifyRecallSignature({ svixId: id, svixTimestamp: ts, svixSignature }, `${body}x`, secret),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const svixSignature = `v1,${sign(secret, id, ts, body)}`;
    const otherSecret = `whsec_${Buffer.from("a-different-key").toString("base64")}`;
    expect(
      verifyRecallSignature({ svixId: id, svixTimestamp: ts, svixSignature }, body, otherSecret),
    ).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(
      verifyRecallSignature(
        { svixId: id, svixTimestamp: ts, svixSignature: undefined },
        body,
        secret,
      ),
    ).toBe(false);
  });

  it("rejects a stale timestamp even with a valid signature", () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 4000);
    const svixSignature = `v1,${sign(secret, id, staleTs, body)}`;
    expect(
      verifyRecallSignature({ svixId: id, svixTimestamp: staleTs, svixSignature }, body, secret),
    ).toBe(false);
  });
});
