import { expect, test } from "bun:test";
import { CheckViolationError, DbUpdateError, ForeignKeyViolationError, LockTimeoutError, NotNullViolationError, OrmError, translateDatabaseError, TransactionOutcomeUnknownError, UniqueViolationError } from "../index";
import { isConfirmedStatementRejection } from "../Providers/transactionOutcome";

const driverError = (errno: string, extra: Record<string, unknown> = {}) => Object.assign(new Error("server message"), { name: "PostgresError", errno, code: "ERR_POSTGRES_SERVER_ERROR", ...extra });

test("SQLSTATE constraint violations become ORM errors with their names and cause", () => {
  const fk = translateDatabaseError(driverError("23503", { constraint: "fk_products_categoryId", table: "products" })) as ForeignKeyViolationError;
  expect(fk).toBeInstanceOf(ForeignKeyViolationError); expect(fk).toBeInstanceOf(DbUpdateError);
  expect([fk.constraint, fk.table, fk.message]).toEqual(["fk_products_categoryId", "products", 'Foreign key constraint "fk_products_categoryId" violated: the row refers to a missing row, or a row that other rows refer to was deleted.']);
  const check = translateDatabaseError(driverError("23514", { constraint: "ck_products_price", table: "products" })) as CheckViolationError;
  expect(check).toBeInstanceOf(CheckViolationError); expect(check.message).toBe('Check constraint "ck_products_price" violated.');
  const notNull = translateDatabaseError(driverError("23502", { column: "title", table: "products" })) as NotNullViolationError;
  expect(notNull).toBeInstanceOf(NotNullViolationError); expect([notNull.column, notNull.message]).toEqual(["title", 'Column "title" of table "products" does not accept NULL.']);
  expect(translateDatabaseError(driverError("23505", { constraint: "ix_x" }))).toBeInstanceOf(UniqueViolationError);
  const lock = translateDatabaseError(driverError("55P03")) as LockTimeoutError;
  expect(lock).toBeInstanceOf(LockTimeoutError);
  expect(lock.message).toBe("A lock was not granted within lockTimeoutMs: another transaction holds the row or table. Retry the operation, or shorten the transaction that holds the lock.");
  for (const error of [fk, check, notNull, lock]) {
    expect((error as Error).cause).toBeDefined();
    expect(isConfirmedStatementRejection(error)).toBe(true);
  }
});

test("other errors and ORM errors pass through unchanged", () => {
  const other = driverError("42601");
  const orm = new OrmError("mapped");
  expect(translateDatabaseError(other)).toBe(other);
  expect(translateDatabaseError(orm)).toBe(orm);
  expect(translateDatabaseError("text")).toBe("text");
});

test("an unanswered statement outside a transaction says so instead of a transaction outcome", () => {
  const timeout = new OrmError("ORM operation timed out after 5000 ms.");
  expect(new TransactionOutcomeUnknownError(timeout, "statement").message).toBe("The database did not answer a statement sent outside a transaction: ORM operation timed out after 5000 ms. If the statement changed data, its outcome is unknown: check the data and use a new DbContext before saving again.");
  expect(new TransactionOutcomeUnknownError(undefined, "commit").message).toBe("Transaction outcome is unknown. Reconcile database state and use a new DbContext before saving again.");
});
