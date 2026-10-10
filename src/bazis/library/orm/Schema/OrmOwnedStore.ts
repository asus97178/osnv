import { types } from "node:util";
import { OrmOwnedStoreAdmissionError } from "../errors";

export interface OrmCatalogScopeV1 {
  readonly schema: string;
  readonly tablePrefix: string;
}

export interface OrmOwnedStoreDefinitionV1 {
  readonly contract: "bazis.orm-owned-store/v1";
  readonly storeKey: string;
  readonly formatVersion: number;
  readonly ownedScope: OrmCatalogScopeV1;
  readonly rejectIfPresent?: readonly OrmCatalogScopeV1[];
}

const IDENTITY_MISMATCH = "ORM_OWNED_STORE_IDENTITY_MISMATCH";
const OWNERSHIP_CONFLICT = "ORM_OWNED_STORE_OWNERSHIP_CONFLICT";
const CONTRACT = "bazis.orm-owned-store/v1" as const;
const maxRejectScopes = 64;
const canonicalDefinitions = new WeakSet<object>();

/**
 * Takes a hostile-input-safe snapshot of an owned-store descriptor.  This is
 * deliberately a nominal boundary only; its private identity is installed by
 * later lifecycle work, never on the caller's object.
 */
export function defineOrmOwnedStoreV1(definition: OrmOwnedStoreDefinitionV1): Readonly<OrmOwnedStoreDefinitionV1> {
  try {
    rejectProxy(definition);
    const root = closedRecord(definition, ["contract", "storeKey", "formatVersion", "ownedScope", "rejectIfPresent"], ["contract", "storeKey", "formatVersion", "ownedScope"], "the definition");
    const contract = root.contract;
    const storeKey = root.storeKey;
    const formatVersion = root.formatVersion;
    if (contract !== CONTRACT) throw identity(`contract must be "${CONTRACT}"`);
    if (!validString(storeKey, 128)) throw identity("storeKey must be a string of 1 to 128 bytes without control characters");
    if (typeof formatVersion !== "number" || !Number.isSafeInteger(formatVersion) || formatVersion <= 0) throw identity("formatVersion must be a positive integer");
    const ownedScope = readScope(root.ownedScope, "ownedScope");
    const rejectIfPresent = root.rejectIfPresent === undefined ? [] : readScopes(root.rejectIfPresent);
    if (rejectIfPresent.some((scope) => sameScope(scope, ownedScope))) throw ownership(`rejectIfPresent of "${storeKey}" lists its own ownedScope`);
    const canonicalRejects = uniqueSortedScopes(rejectIfPresent);
    const result: OrmOwnedStoreDefinitionV1 = canonicalRejects.length === 0
      ? { contract: CONTRACT, storeKey, formatVersion, ownedScope }
      : { contract: CONTRACT, storeKey, formatVersion, ownedScope, rejectIfPresent: canonicalRejects };
    const frozen = deepFreeze(result);
    canonicalDefinitions.add(frozen);
    return frozen;
  } catch (error) {
    if (error instanceof OrmOwnedStoreAdmissionError) throw error;
    throw identity();
  }
}

/** Private nominal check for the later core lifecycle; intentionally not barrel-exported. */
export function isDefinedOrmOwnedStoreV1(value: unknown): value is Readonly<OrmOwnedStoreDefinitionV1> {
  return value !== null && typeof value === "object" && canonicalDefinitions.has(value);
}

function readScopes(value: unknown): readonly OrmCatalogScopeV1[] {
  rejectProxy(value);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw identity("rejectIfPresent must be an array of { schema, tablePrefix }");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw identity();
  if (value.length > maxRejectScopes) throw identity(`rejectIfPresent may list at most ${maxRejectScopes} scopes`);
  const expected = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (Object.keys(descriptors).some((key) => !expected.has(key))) throw identity();
  const scopes: OrmCatalogScopeV1[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) throw identity();
    scopes.push(readScope(descriptor.value, `rejectIfPresent[${index}]`));
  }
  return scopes;
}

function readScope(value: unknown, path: string): OrmCatalogScopeV1 {
  const record = closedRecord(value, ["schema", "tablePrefix"], ["schema", "tablePrefix"], path);
  if (!validString(record.schema, 63) || !validString(record.tablePrefix, 63)) throw identity(`${path}.schema and ${path}.tablePrefix must be strings of 1 to 63 bytes without control characters`);
  return { schema: record.schema, tablePrefix: record.tablePrefix };
}

function closedRecord(value: unknown, allowed: readonly string[], required: readonly string[], path: string): Record<string, unknown> {
  rejectProxy(value);
  if (value === null || typeof value !== "object") throw identity(`${path} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw identity(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw identity();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    // JSON.stringify escapes control characters of a caller-chosen key.
    if (!allowed.includes(key)) throw identity(`${path} has an unknown field ${JSON.stringify(key.slice(0, 64))}; allowed: ${allowed.join(", ")}`);
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || descriptor.value === undefined) throw identity(`${path}.${key} must be a plain value`);
  }
  for (const key of required) if (!Object.hasOwn(descriptors, key)) throw identity(`${path} is missing the field ${key}`);
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, (descriptor as PropertyDescriptor & { value: unknown }).value]));
}

function validString(value: unknown, maxBytes: number): value is string {
  if (typeof value !== "string") return false;
  if (Buffer.byteLength(value, "utf8") < 1 || Buffer.byteLength(value, "utf8") > maxBytes) return false;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index++;
      continue;
    }
    if ((unit >= 0xdc00 && unit <= 0xdfff) || unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f)) return false;
  }
  return true;
}

function uniqueSortedScopes(scopes: readonly OrmCatalogScopeV1[]): readonly OrmCatalogScopeV1[] {
  const result = [...scopes].sort(compareScope);
  return result.filter((scope, index) => index === 0 || !sameScope(scope, result[index - 1]!)).map((scope) => ({ ...scope }));
}
function compareScope(left: OrmCatalogScopeV1, right: OrmCatalogScopeV1): number {
  return Buffer.compare(Buffer.from(left.schema, "utf8"), Buffer.from(right.schema, "utf8")) || Buffer.compare(Buffer.from(left.tablePrefix, "utf8"), Buffer.from(right.tablePrefix, "utf8"));
}
function sameScope(left: OrmCatalogScopeV1, right: OrmCatalogScopeV1): boolean { return left.schema === right.schema && left.tablePrefix === right.tablePrefix; }
function rejectProxy(value: unknown): void { if (value !== null && (typeof value === "object" || typeof value === "function") && types.isProxy(value)) throw identity(); }
/** Proxies and symbols keep the bare code: describing them could run caller traps. */
function identity(reason?: string): OrmOwnedStoreAdmissionError { return new OrmOwnedStoreAdmissionError(IDENTITY_MISMATCH, reason === undefined ? IDENTITY_MISMATCH : `${IDENTITY_MISMATCH}: owned store definition is invalid: ${reason}.`); }
function ownership(reason: string): OrmOwnedStoreAdmissionError { return new OrmOwnedStoreAdmissionError(OWNERSHIP_CONFLICT, `${OWNERSHIP_CONFLICT}: owned store definition is invalid: ${reason}.`); }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
