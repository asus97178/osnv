import { toArrayBuffer } from "../base64url";
import { decodePemToBuffer, encodePem } from "./pem";
import type { SigningAlgorithm } from "./SigningAlgorithm";

const RSA_PARAMS = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const encoder = new TextEncoder();

export interface Rs256KeyMaterial {
  /** PKCS#8 private key PEM — required to sign, optional for verify-only. */
  readonly privateKeyPem?: string;
  /** SPKI public key PEM — required to verify. */
  readonly publicKeyPem: string;
  /** `kid` header value and verify-time match (default: no `kid`). */
  readonly keyId?: string;
}

/**
 * Asymmetric RS256 (RSASSA-PKCS1-v1.5 + SHA-256).
 *
 * The private key signs; the public key verifies. Verifiers can hold only the
 * public key, which is the recommended setup for separating an auth issuer
 * from resource services. Imported keys are cached for the hot path.
 */
export class Rs256Algorithm implements SigningAlgorithm {
  public readonly alg = "RS256";
  public readonly canSign: boolean;
  public readonly keyId?: string;

  private cachedPrivate?: CryptoKey;
  private cachedPublic?: CryptoKey;
  private readonly keys: Rs256KeyMaterial;

  public constructor(keys: Rs256KeyMaterial) {
    if (keys === null || typeof keys !== "object" || Array.isArray(keys)) {
      throw new TypeError("RS256 key material must be an object");
    }
    for (const field of ["publicKeyPem", "privateKeyPem", "keyId"] as const) {
      const value = keys[field];
      if (value === undefined && field !== "publicKeyPem") continue;
      if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`RS256 ${field} must be a non-empty string`);
      }
    }
    // A wrong key format must fail here, at startup, not on the first sign-in.
    this.keys = Object.freeze({
      ...keys,
      publicKeyPem: checkedPem("publicKeyPem", keys.publicKeyPem),
      ...(keys.privateKeyPem === undefined ? {} : { privateKeyPem: checkedPem("privateKeyPem", keys.privateKeyPem) }),
    });
    this.canSign = this.keys.privateKeyPem !== undefined;
    this.keyId = this.keys.keyId;
  }

  public async sign(signingInput: string): Promise<Uint8Array> {
    const key = await this.importPrivateKey();
    const signature = await crypto.subtle.sign(RSA_PARAMS, key, encoder.encode(signingInput));
    return new Uint8Array(signature);
  }

  public async verify(signingInput: string, signature: Uint8Array): Promise<boolean> {
    const key = await this.importPublicKey();
    return crypto.subtle.verify(RSA_PARAMS, key, toArrayBuffer(signature), encoder.encode(signingInput));
  }

  /** Exports the public key as a JWK (for serving `/.well-known/jwks.json`). */
  public async exportPublicJwk(): Promise<Record<string, string>> {
    const key = await this.importPublicKey();
    const jwk = (await crypto.subtle.exportKey("jwk", key)) as { n?: string; e?: string };
    return {
      kty: "RSA",
      use: "sig",
      alg: "RS256",
      n: jwk.n!,
      e: jwk.e!,
      ...(this.keyId === undefined ? {} : { kid: this.keyId }),
    };
  }

  private async importPrivateKey(): Promise<CryptoKey> {
    if (this.cachedPrivate !== undefined) {
      return this.cachedPrivate;
    }
    if (this.keys.privateKeyPem === undefined) {
      throw new Error("RS256 private key PEM is required for signing");
    }
    const key = await importKey("private", () => crypto.subtle.importKey(
      "pkcs8",
      decodePemToBuffer(this.keys.privateKeyPem!),
      RSA_PARAMS,
      false,
      ["sign"],
    ));
    return this.cachedPrivate = this.requireStrongKey(key);
  }

  private async importPublicKey(): Promise<CryptoKey> {
    if (this.cachedPublic !== undefined) {
      return this.cachedPublic;
    }
    const key = await importKey("public", () => crypto.subtle.importKey(
      "spki",
      decodePemToBuffer(this.keys.publicKeyPem),
      RSA_PARAMS,
      true,
      ["verify"],
    ));
    return this.cachedPublic = this.requireStrongKey(key);
  }

  private requireStrongKey(key: CryptoKey): CryptoKey {
    const parameters = key.algorithm;
    if (!("modulusLength" in parameters) || typeof parameters.modulusLength !== "number" ||
        !Number.isInteger(parameters.modulusLength) || parameters.modulusLength < 2048) {
      throw new RangeError("RS256 keys must be at least 2048 bits");
    }
    return key;
  }
}

const PEM = /^-----BEGIN ([A-Z0-9 ]+)-----\n([\s\S]*?)\n?-----END \1-----$/;

/**
 * Normalizes and checks one PEM string: literal `\n` (a key stored on one line
 * in .env or a CI secret) and CRLF become line breaks; the label must be the
 * one Web Crypto imports (PKCS#8 private, SPKI public), with a fix otherwise.
 */
function checkedPem(field: "publicKeyPem" | "privateKeyPem", value: string): string {
  // A backslash never occurs in base64 or PEM armor, so this cannot change a valid key.
  const pem = value.replaceAll("\\n", "\n").replaceAll("\r\n", "\n").trim();
  const expected = field === "publicKeyPem" ? "PUBLIC KEY" : "PRIVATE KEY";
  const match = PEM.exec(pem);
  const label = match?.[1] ?? /^-----BEGIN ([A-Z0-9 ]+)-----/.exec(pem)?.[1];
  if (label === undefined) throw new TypeError(`RS256 ${field} is not a PEM: expected "-----BEGIN ${expected}-----"`);
  if (field === "privateKeyPem" && label === "RSA PRIVATE KEY") throw new TypeError("RS256 privateKeyPem is a PKCS#1 key (BEGIN RSA PRIVATE KEY); convert it to PKCS#8: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem");
  if (field === "privateKeyPem" && label === "ENCRYPTED PRIVATE KEY") throw new TypeError("RS256 privateKeyPem is encrypted; remove the passphrase first: openssl pkcs8 -in key.pem -out key-plain.pem");
  if (field === "privateKeyPem" && label.endsWith("PUBLIC KEY")) throw new TypeError("RS256 privateKeyPem contains a PUBLIC KEY; pass the private key (BEGIN PRIVATE KEY)");
  if (field === "publicKeyPem" && label === "RSA PUBLIC KEY") throw new TypeError("RS256 publicKeyPem is a PKCS#1 public key (BEGIN RSA PUBLIC KEY); convert it to SPKI: openssl rsa -RSAPublicKey_in -in public.pem -pubout -out public-spki.pem");
  if (field === "publicKeyPem" && label.endsWith("PRIVATE KEY")) throw new TypeError("RS256 publicKeyPem contains a private key; give verifiers only the public key: openssl pkey -in key.pem -pubout -out public.pem");
  if (label !== expected || match === undefined || match === null) throw new TypeError(`RS256 ${field} is not a PEM: expected "-----BEGIN ${expected}-----"`);
  if (!/^[A-Za-z0-9+/=\s]+$/.test(match[2]!)) throw new TypeError(`RS256 ${field} has an invalid base64 body`);
  return pem;
}

/** Web Crypto says only "Invalid keyData"; name the key that failed. */
async function importKey(which: "private" | "public", work: () => Promise<CryptoKey>): Promise<CryptoKey> {
  try {
    return await work();
  } catch (error) {
    throw new Error(`RS256 ${which} key could not be imported (${error instanceof Error ? error.message : String(error)}); check that it is an RSA ${which === "private" ? "PKCS#8 private" : "SPKI public"} key in PEM`, { cause: error });
  }
}

/** Convenience factory for {@link Rs256Algorithm}. */
export function rs256(keys: Rs256KeyMaterial): Rs256Algorithm {
  return new Rs256Algorithm(keys);
}

/** Generates an RSA-2048 key pair as PEM strings (bootstrap / tests). */
export async function generateRsaKeyPairPem(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const privateDer = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const publicDer = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return {
    privateKeyPem: encodePem("PRIVATE KEY", privateDer),
    publicKeyPem: encodePem("PUBLIC KEY", publicDer),
  };
}
