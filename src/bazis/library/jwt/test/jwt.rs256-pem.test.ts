import { expect, test } from "bun:test";
import { generateRsaKeyPairPem, JwtValidator, rs256, TokenIssuer } from "../index";

const { publicKeyPem, privateKeyPem } = await generateRsaKeyPairPem();
const issuerWith = (privatePem: string, publicPem: string) => new TokenIssuer({ issuer: "auth", audience: "api", algorithm: rs256({ privateKeyPem: privatePem, publicKeyPem: publicPem }), accessTtlSeconds: 60, refreshTtlSeconds: 60 });

test("a PEM with literal \\n sequences, as in .env files and CI secrets, works", async () => {
  const oneLine = (pem: string) => pem.trim().replaceAll("\n", "\\n");
  const pair = await issuerWith(oneLine(privateKeyPem), oneLine(publicKeyPem)).issue("ann");
  const verified = await new JwtValidator(rs256({ publicKeyPem: oneLine(publicKeyPem) }), { issuer: "auth", audience: "api" }).validate(pair.accessToken);
  expect(verified.payload.sub).toBe("ann");
  expect((await issuerWith(privateKeyPem.replaceAll("\n", "\r\n"), publicKeyPem).issue("bob")).tokenType).toBe("Bearer");
});

test("a wrong key format is reported when the algorithm is created, with the fix", () => {
  const pkcs1 = privateKeyPem.replaceAll("PRIVATE KEY", "RSA PRIVATE KEY");
  expect(() => rs256({ privateKeyPem: pkcs1, publicKeyPem })).toThrow("RS256 privateKeyPem is a PKCS#1 key (BEGIN RSA PRIVATE KEY); convert it to PKCS#8: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem");
  expect(() => rs256({ privateKeyPem: publicKeyPem, publicKeyPem })).toThrow("RS256 privateKeyPem contains a PUBLIC KEY; pass the private key (BEGIN PRIVATE KEY)");
  expect(() => rs256({ privateKeyPem, publicKeyPem: privateKeyPem })).toThrow("RS256 publicKeyPem contains a private key; give verifiers only the public key: openssl pkey -in key.pem -pubout -out public.pem");
  expect(() => rs256({ publicKeyPem: publicKeyPem.replaceAll("PUBLIC KEY", "RSA PUBLIC KEY") })).toThrow("RS256 publicKeyPem is a PKCS#1 public key (BEGIN RSA PUBLIC KEY); convert it to SPKI: openssl rsa -RSAPublicKey_in -in public.pem -pubout -out public-spki.pem");
  expect(() => rs256({ privateKeyPem: privateKeyPem.replaceAll("PRIVATE KEY", "ENCRYPTED PRIVATE KEY"), publicKeyPem })).toThrow("RS256 privateKeyPem is encrypted; remove the passphrase first: openssl pkcs8 -in key.pem -out key-plain.pem");
  expect(() => rs256({ publicKeyPem: "not a pem" })).toThrow('RS256 publicKeyPem is not a PEM: expected "-----BEGIN PUBLIC KEY-----"');
  expect(() => rs256({ publicKeyPem: "-----BEGIN PUBLIC KEY-----\n@@@\n-----END PUBLIC KEY-----" })).toThrow("RS256 publicKeyPem has an invalid base64 body");
});

test("a key that still fails to import says which key and why", async () => {
  const broken = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----";
  await expect(issuerWith(broken, publicKeyPem).issue("ann")).rejects.toThrow("RS256 private key could not be imported");
});
