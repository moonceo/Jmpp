import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";

import {
  CredentialEncryptionError,
  createCredentialCipher,
} from "@/lib/server/security/credential-encryption";

const CONTEXT = {
  tenantId: "5cd2f222-f6d1-4c58-b690-ddc87df41f4f",
  marketAccountId: "211a8e32-7f86-4c86-8a43-77893f8165c4",
  secretType: "API_CREDENTIALS",
} as const;

test("encrypts and decrypts a credential with its tenant-bound context", () => {
  const cipher = createCredentialCipher(randomBytes(32).toString("base64"));
  const plaintext = '{"accessKey":"한글-secret","token":"abc123"}';
  const envelope = cipher.encrypt(plaintext, CONTEXT);

  expect(envelope).toMatch(/^jpcred\.v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(cipher.decrypt(envelope, CONTEXT)).toBe(plaintext);
});

test("uses a fresh IV for every encryption", () => {
  const cipher = createCredentialCipher(randomBytes(32).toString("base64"));

  expect(cipher.encrypt("same-secret", CONTEXT)).not.toBe(
    cipher.encrypt("same-secret", CONTEXT),
  );
});

test("rejects a credential copied to a different tenant context", () => {
  const cipher = createCredentialCipher(randomBytes(32).toString("base64"));
  const envelope = cipher.encrypt("secret", CONTEXT);

  expect(() => cipher.decrypt(envelope, {
        ...CONTEXT,
        tenantId: "85e178af-f6df-4291-9e73-af5531b5b608",
      })).toThrow(CredentialEncryptionError);
});

test("rejects a tampered authentication tag", () => {
  const cipher = createCredentialCipher(randomBytes(32).toString("base64"));
  const envelopeParts = cipher.encrypt("secret", CONTEXT).split(".");
  envelopeParts[3] = `${envelopeParts[3].slice(0, -1)}${
    envelopeParts[3].endsWith("A") ? "B" : "A"
  }`;

  expect(() => cipher.decrypt(envelopeParts.join("."), CONTEXT)).toThrow(
    CredentialEncryptionError,
  );
});

test("requires a canonical base64 256-bit key", () => {
  expect(() => createCredentialCipher("not-a-base64-key")).toThrow(
    CredentialEncryptionError,
  );
  expect(() => createCredentialCipher(randomBytes(16).toString("base64"))).toThrow(
    CredentialEncryptionError,
  );
});
