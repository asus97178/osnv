import {
  CheckViolationError,
  EntityNotFoundError,
  ForeignKeyViolationError,
  LockTimeoutError,
  NotNullViolationError,
  OrmTransactionScopeError,
  OrmValidationError,
  TransactionOutcomeUnknownError,
  UniqueViolationError,
} from "../../library/orm";

/** SQLSTATEs a client may retry: serialization failure, deadlock, statement timeout. */
const RETRYABLE = new Set(["40001", "40P01", "57014"]);

/**
 * HTTP status for a database error, for `http: { errorHandler: { status:
 * databaseErrorStatus } }`: 409 for a unique or foreign key conflict, 422 for
 * a check, not-null or entity validation failure, 404 for `first()` without a
 * row, 503 when the database did not answer, a lock or the transaction timed
 * out, or a retryable conflict happened. Anything else stays 500.
 */
export function databaseErrorStatus(error: unknown): number | undefined {
  if (error instanceof UniqueViolationError || error instanceof ForeignKeyViolationError) return 409;
  if (error instanceof CheckViolationError || error instanceof NotNullViolationError || error instanceof OrmValidationError) return 422;
  if (error instanceof EntityNotFoundError) return 404;
  if (error instanceof LockTimeoutError || error instanceof TransactionOutcomeUnknownError) return 503;
  if (error instanceof OrmTransactionScopeError && / timed out after \d+ ms/.test(error.message)) return 503;
  if (typeof error === "object" && error !== null) {
    const { errno, code } = error as { errno?: unknown; code?: unknown };
    if (typeof errno === "string" && RETRYABLE.has(errno)) return 503;
    if (typeof code === "string" && code.startsWith("ERR_POSTGRES_CONNECTION")) return 503;
  }
  return undefined;
}
