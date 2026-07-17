import { Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { parseMeetAccounts } from "./index.ts";

const valid = JSON.stringify([
  {
    name: "personal",
    refreshToken: "1//token-a",
    targetResource: "//cloudidentity.googleapis.com/users/111",
  },
  {
    name: "work",
    refreshToken: "1//token-b",
    targetResource: "//cloudidentity.googleapis.com/users/222",
  },
]);

describe("parseMeetAccounts", () => {
  it("parses a valid account list and redacts the tokens", () => {
    const accounts = parseMeetAccounts(valid);
    expect(accounts.map((a) => a.name)).toEqual(["personal", "work"]);
    expect(Redacted.value(accounts[0]?.refreshToken as Redacted.Redacted<string>)).toBe(
      "1//token-a",
    );
    expect(accounts[1]?.targetResource).toBe("//cloudidentity.googleapis.com/users/222");
  });

  it("parses blank input to an empty list", () => {
    expect(parseMeetAccounts("")).toEqual([]);
    expect(parseMeetAccounts("   ")).toEqual([]);
  });

  it("rejects malformed JSON (including the terraform placeholder)", () => {
    expect(() => parseMeetAccounts("REPLACE_ME_WITH_MEET_ACCOUNTS_JSON")).toThrow(/not valid JSON/);
  });

  it("rejects a non-array root", () => {
    expect(() => parseMeetAccounts('{"name":"x"}')).toThrow(/must be a JSON array/);
  });

  it("rejects missing fields with the index and name in the message", () => {
    expect(() => parseMeetAccounts('[{"refreshToken":"t","targetResource":"//x/y"}]')).toThrow(
      /accounts\[0\]: missing "name"/,
    );
    expect(() => parseMeetAccounts('[{"name":"work","targetResource":"//x/y"}]')).toThrow(
      /\("work"\): missing "refreshToken"/,
    );
    expect(() => parseMeetAccounts('[{"name":"work","refreshToken":"t"}]')).toThrow(
      /"targetResource" must be a full resource name/,
    );
  });

  it("rejects a targetResource that is not a full resource name", () => {
    expect(() =>
      parseMeetAccounts('[{"name":"w","refreshToken":"t","targetResource":"users/123"}]'),
    ).toThrow(/full resource name/);
  });

  it("rejects duplicate account names", () => {
    const dup = JSON.stringify([
      { name: "work", refreshToken: "a", targetResource: "//x/1" },
      { name: "work", refreshToken: "b", targetResource: "//x/2" },
    ]);
    expect(() => parseMeetAccounts(dup)).toThrow(/duplicate name "work"/);
  });
});
