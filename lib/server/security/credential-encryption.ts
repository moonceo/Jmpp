import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENVELOPE_PREFIX = "jpcred.v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CredentialEncryptionContext {
  tenantId: string;
  marketAccountId: string;
  secretType: string;
}

export interface CredentialCipher {
  encrypt(plaintext: string, context: CredentialEncryptionContext): string;
  decrypt(envelope: string, context: CredentialEncryptionContext): string;
}

export class CredentialEncryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialEncryptionError";
  }
}

function decodeDataEncryptionKey(encodedKey: string): Buffer {
  const value = encodedKey.trim();

  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new CredentialEncryptionError(
      "DATA_ENCRYPTION_KEY must be canonical base64.",
    );
  }

  const key = Buffer.from(value, "base64");

  if (key.length !== KEY_BYTES || key.toString("base64") !== value) {
    key.fill(0);
    throw new CredentialEncryptionError(
      "DATA_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }

  return key;
}

function validateContext(context: CredentialEncryptionContext): void {
  if (!UUID_PATTERN.test(context.tenantId)) {
    throw new CredentialEncryptionError(
      "Credential encryption context tenantId must be a valid UUID.",
    );
  }

  if (!UUID_PATTERN.test(context.marketAccountId)) {
    throw new CredentialEncryptionError(
      "Credential encryption context marketAccountId must be a valid UUID.",
    );
  }

  if (
    !context.secretType ||
    context.secretType !== context.secretType.trim() ||
    context.secretType.includes("\0")
  ) {
    throw new CredentialEncryptionError(
      "Credential encryption context secretType must be a non-empty, trimmed value.",
    );
  }
}

function additionalAuthenticatedData(
  context: CredentialEncryptionContext,
): Buffer {
  validateContext(context);

  return Buffer.from(
    [
      ENVELOPE_PREFIX,
      context.tenantId.toLowerCase(),
      context.marketAccountId.toLowerCase(),
      context.secretType,
    ].join("\0"),
    "utf8",
  );
}

function decodeEnvelopePart(
  value: string,
  name: string,
  expectedLength?: number,
): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CredentialEncryptionError(
      `Credential envelope ${name} is not valid base64url.`,
    );
  }

  const decoded = Buffer.from(value, "base64url");

  if (
    decoded.toString("base64url") !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    decoded.fill(0);
    throw new CredentialEncryptionError(
      `Credential envelope ${name} has an invalid length or encoding.`,
    );
  }

  return decoded;
}

function parseEnvelope(envelope: string): {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
} {
  const parts = envelope.split(".");

  if (
    parts.length !== 5 ||
    `${parts[0]}.${parts[1]}` !== ENVELOPE_PREFIX
  ) {
    throw new CredentialEncryptionError(
      "Credential envelope has an unsupported format or version.",
    );
  }

  return {
    iv: decodeEnvelopePart(parts[2], "IV", IV_BYTES),
    tag: decodeEnvelopePart(parts[3], "authentication tag", AUTH_TAG_BYTES),
    ciphertext: decodeEnvelopePart(parts[4], "ciphertext"),
  };
}

export function createCredentialCipher(encodedKey: string): CredentialCipher {
  const key = decodeDataEncryptionKey(encodedKey);

  return {
    encrypt(plaintext, context) {
      if (plaintext.length === 0) {
        throw new CredentialEncryptionError(
          "A credential must not be an empty string.",
        );
      }

      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      cipher.setAAD(additionalAuthenticatedData(context));

      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();

      return [
        ENVELOPE_PREFIX,
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },

    decrypt(envelope, context) {
      let parsed: ReturnType<typeof parseEnvelope> | undefined;

      try {
        parsed = parseEnvelope(envelope);
        const decipher = createDecipheriv(ALGORITHM, key, parsed.iv, {
          authTagLength: AUTH_TAG_BYTES,
        });
        decipher.setAAD(additionalAuthenticatedData(context));
        decipher.setAuthTag(parsed.tag);

        return Buffer.concat([
          decipher.update(parsed.ciphertext),
          decipher.final(),
        ]).toString("utf8");
      } catch (error) {
        if (error instanceof CredentialEncryptionError) {
          throw error;
        }

        throw new CredentialEncryptionError(
          "Credential decryption failed. The key, context, or ciphertext is invalid.",
          { cause: error },
        );
      } finally {
        parsed?.ciphertext.fill(0);
      }
    },
  };
}

let cachedEnvironmentKey: string | undefined;
let cachedEnvironmentCipher: CredentialCipher | undefined;

function environmentCredentialCipher(): CredentialCipher {
  const encodedKey = process.env.DATA_ENCRYPTION_KEY?.trim();

  if (!encodedKey) {
    throw new CredentialEncryptionError(
      "DATA_ENCRYPTION_KEY must be set before encrypting credentials.",
    );
  }

  if (!cachedEnvironmentCipher || encodedKey !== cachedEnvironmentKey) {
    cachedEnvironmentKey = encodedKey;
    cachedEnvironmentCipher = createCredentialCipher(encodedKey);
  }

  return cachedEnvironmentCipher;
}

export function encryptCredential(
  plaintext: string,
  context: CredentialEncryptionContext,
): string {
  return environmentCredentialCipher().encrypt(plaintext, context);
}

export function decryptCredential(
  envelope: string,
  context: CredentialEncryptionContext,
): string {
  return environmentCredentialCipher().decrypt(envelope, context);
}
