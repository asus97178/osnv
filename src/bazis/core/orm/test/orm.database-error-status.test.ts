import { expect, test } from "bun:test";
import { errorHandler } from "@/core/http/Middleware/errorHandler";
import { CheckViolationError, databaseErrorStatus, EntityNotFoundError, ForeignKeyViolationError, LockTimeoutError, NotNullViolationError, OrmError, OrmTransactionScopeError, OrmValidationError, TransactionOutcomeUnknownError, UniqueViolationError } from "@/core/orm";

const pg = (errno: string, extra: Record<string, unknown> = {}) => Object.assign(new Error("x"), { name: "PostgresError", errno, code: "ERR_POSTGRES_SERVER_ERROR", ...extra });

test("databaseErrorStatus maps database errors to HTTP statuses", () => {
  expect(databaseErrorStatus(new UniqueViolationError(pg("23505")))).toBe(409);
  expect(databaseErrorStatus(new ForeignKeyViolationError(pg("23503")))).toBe(409);
  expect(databaseErrorStatus(new CheckViolationError(pg("23514")))).toBe(422);
  expect(databaseErrorStatus(new NotNullViolationError(pg("23502")))).toBe(422);
  expect(databaseErrorStatus(new OrmValidationError("Product", []))).toBe(422);
  expect(databaseErrorStatus(new EntityNotFoundError("Product"))).toBe(404);
  expect(databaseErrorStatus(new LockTimeoutError(pg("55P03")))).toBe(503);
  expect(databaseErrorStatus(new TransactionOutcomeUnknownError(undefined, "statement"))).toBe(503);
  expect(databaseErrorStatus(new OrmTransactionScopeError("ORM transaction scope timed out after 200 ms."))).toBe(503);
  for (const errno of ["40001", "40P01", "57014"]) expect(databaseErrorStatus(pg(errno))).toBe(503);
  expect(databaseErrorStatus(Object.assign(new Error("closed"), { code: "ERR_POSTGRES_CONNECTION_CLOSED" }))).toBe(503);
  expect(databaseErrorStatus(new OrmError("other"))).toBeUndefined();
  expect(databaseErrorStatus(new Error("other"))).toBeUndefined();
});

test("errorHandler status option answers with the mapped status and logs only 5xx", async () => {
  const logged: unknown[] = [];
  const middleware = errorHandler({ status: databaseErrorStatus, logError: (error) => logged.push(error) });
  const respond = async (error: unknown) => { const ctx: { response?: Response } = {}; await middleware(ctx as never, async () => { throw error; }); return [ctx.response!.status, await ctx.response!.json()]; };
  expect(await respond(new UniqueViolationError(pg("23505", { constraint: "ix_categories_name" })))).toEqual([409, { error: "Conflict" }]);
  expect(await respond(new CheckViolationError(pg("23514")))).toEqual([422, { error: "Unprocessable Content" }]);
  expect(await respond(new EntityNotFoundError("Product"))).toEqual([404, { error: "Not Found" }]);
  expect(logged).toHaveLength(0);
  expect(await respond(new LockTimeoutError(pg("55P03")))).toEqual([503, { error: "Service Unavailable" }]);
  expect(await respond(new Error("bug"))).toEqual([500, { error: "Internal Server Error" }]);
  expect(logged).toHaveLength(2);
  const plain = errorHandler({ logError: () => {} });
  const ctx: { response?: Response } = {};
  await plain(ctx as never, async () => { throw new UniqueViolationError(pg("23505")); });
  expect(ctx.response!.status).toBe(500);
});
