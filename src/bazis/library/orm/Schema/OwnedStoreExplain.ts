import { OrmOwnedStoreAdmissionError, type OrmOwnedStoreAdmissionErrorCode } from "../errors";
import type { OrmCatalogScopeV1, OrmOwnedStoreDefinitionV1 } from "./OrmOwnedStore";
import type { OwnedStoreCatalogSnapshotV1, OwnedStoreRegistrySnapshotV1 } from "./OwnedStoreCatalog";

/** What admission had already read when it failed; filled only with parsed, validated snapshots. */
export interface OwnedStoreObservationV1 {
  stores?: readonly { readonly definition: Readonly<OrmOwnedStoreDefinitionV1>; readonly modelHash: string; readonly ownedScopeHash: string }[];
  registry?: OwnedStoreRegistrySnapshotV1;
  catalogue?: OwnedStoreCatalogSnapshotV1;
}

const REGISTRY = "__bazis_orm_owned_stores_v1";

/**
 * Turns a bare admission code into a readable message. The checks themselves
 * stay code-only; this runs after admission failed and recomputes the likely
 * reason from the same trusted inputs. Names from the code (store keys,
 * prefixes) are validated by `defineOrmOwnedStoreV1`; names read from the
 * database are escaped and bounded. Row values and driver text never appear.
 */
export function explainOwnedStoreFailureV1(code: OrmOwnedStoreAdmissionErrorCode, observed: OwnedStoreObservationV1): OrmOwnedStoreAdmissionError {
  const stores = observed.stores ?? [];
  if (stores.length === 0) return new OrmOwnedStoreAdmissionError(code, code);
  const rows = observed.registry?.state.kind === "present" ? observed.registry.state.rows : [];
  const relations = (observed.catalogue?.relations ?? []).filter((relation) => relation.kind === "ordinaryTable");
  const tablesIn = (scope: OrmCatalogScopeV1) => relations.filter((relation) => relation.schema === scope.schema && relation.name.startsWith(scope.tablePrefix)).map((relation) => relation.name);
  const all = stores.map((store) => storeName(store.definition)).join(", ");
  const reason = (() => {
    switch (code) {
      case "ORM_OWNED_STORE_IDENTITY_MISMATCH": {
        for (const store of stores) {
          const row = rows.find((item) => item.storeKey === store.definition.storeKey);
          if (!row) continue;
          if (Number(row.formatVersion) !== store.definition.formatVersion) return `${storeName(store.definition)} is registered with format version ${dbNumber(row.formatVersion)}, the code declares ${store.definition.formatVersion}. ${FROZEN}`;
          if (row.ownedSchema !== store.definition.ownedScope.schema || row.tablePrefix !== store.definition.ownedScope.tablePrefix) return `${storeName(store.definition)} is registered with schema ${dbName(row.ownedSchema)}, prefix ${dbName(row.tablePrefix)}. ${FROZEN}`;
          if (row.modelHash !== store.modelHash) return `${storeName(store.definition)}: its model changed since the store was created (tables, columns, keys, indexes or their names). ${FROZEN}`;
        }
        return `${all}: the registered identity does not match the code. ${FROZEN}`;
      }
      case "ORM_OWNED_STORE_IDENTITY_MISSING": {
        for (const store of stores) {
          if (rows.some((row) => row.storeKey === store.definition.storeKey)) continue;
          const occupied = tablesIn(store.definition.ownedScope);
          if (occupied.length > 0) return `${storeName(store.definition)} is not registered yet, but its scope already contains tables that no owned store registered: ${names(occupied)}. Remove them, or choose another tablePrefix.`;
        }
        return `${all}: the store scope contains tables that are not registered in ${REGISTRY}. Remove them, or choose another tablePrefix.`;
      }
      case "ORM_OWNED_STORE_OWNERSHIP_CONFLICT": {
        for (const store of stores) {
          for (const row of rows) {
            if (row.storeKey === store.definition.storeKey) continue;
            if (overlap(store.definition.ownedScope, { schema: row.ownedSchema, tablePrefix: row.tablePrefix })) return `${storeName(store.definition)} overlaps the registered owned store ${dbName(row.storeKey)} (schema ${dbName(row.ownedSchema)}, prefix ${dbName(row.tablePrefix)}); two prefixes overlap when one starts with the other, so "notes_" and "notes_v2_" overlap while "notes_" and "notesv2_" do not.`;
          }
          for (const rejected of store.definition.rejectIfPresent ?? []) {
            const left = tablesIn(rejected);
            if (left.length > 0) return `${storeName(store.definition)} does not start while tables of the rejected scope (schema "${rejected.schema}", prefix "${rejected.tablePrefix}") exist: ${names(left)}. Move their data and drop them, together with their row in ${REGISTRY}.`;
          }
        }
        return `${all}: the store scope conflicts with another owned store or with a foreign key between different stores.`;
      }
      case "ORM_OWNED_STORE_DRIFT": {
        // Only claim what the snapshots show: an unreadable catalogue is not a changed model.
        if (observed.registry !== undefined && observed.catalogue === undefined) return `${all}: the store scope contains an object bazis does not expect there (for example a table with an unusual name or definition, or one created by another tool), so it was not read. Remove such objects from the scope.`;
        const touched = stores.flatMap((store) => tablesIn(store.definition.ownedScope));
        return `${all}: the tables in the store scope${touched.length > 0 ? ` (${names(touched)})` : ""} differ from the store model; they were changed outside the store. Restore them, or move the data to a new store.`;
      }
      case "ORM_OWNED_STORE_CREATE_FAILED":
        return `${all}: creating the store tables or their ${REGISTRY} rows failed. Check that the database user may create tables in the store schema, then start again.`;
      case "ORM_OWNED_STORE_LOCK_UNAVAILABLE":
        return `${all}: admission did not complete: the database connection failed, the start was cancelled, or another instance held the admission lock. Start again.`;
      case "ORM_OWNED_STORE_PROVIDER_UNSUPPORTED":
        return `${all}: owned stores need PostgreSQL through the shared @Infra connection (ormBazisConnect).`;
    }
  })();
  // The code stays first: callers and tests match it in the message text.
  return new OrmOwnedStoreAdmissionError(code, `${code}: ${reason}`);
}

const FROZEN = "An owned store does not change in place: declare a new storeKey with a tablePrefix that does not overlap the old one, move the data, then drop the old tables and their row in __bazis_orm_owned_stores_v1 (rejectIfPresent can guard against leftovers).";

/** Code-side names were validated by defineOrmOwnedStoreV1: bounded, no control characters. */
function storeName(definition: Readonly<OrmOwnedStoreDefinitionV1>): string {
  return `Owned store "${definition.storeKey}" (schema "${definition.ownedScope.schema}", prefix "${definition.ownedScope.tablePrefix}")`;
}

/** A database-side identifier: JSON escapes quotes and control characters, so it cannot forge a log line. */
function dbName(value: string): string {
  const characters = [...value];
  return `${JSON.stringify(characters.slice(0, 63).join(""))}${characters.length > 63 ? "…" : ""}`;
}

function dbNumber(value: string): string {
  return /^\d{1,16}$/.test(value) ? value : dbName(value);
}

function names(values: readonly string[]): string {
  const shown = values.slice(0, 5).map(dbName).join(", ");
  return values.length > 5 ? `${shown} and ${values.length - 5} more` : shown;
}

function overlap(a: OrmCatalogScopeV1, b: OrmCatalogScopeV1): boolean {
  return a.schema === b.schema && (a.tablePrefix.startsWith(b.tablePrefix) || b.tablePrefix.startsWith(a.tablePrefix));
}
