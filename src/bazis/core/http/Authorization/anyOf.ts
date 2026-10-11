import { JwtError } from "../../../library/jwt/errors";
import { ForbiddenError, UnauthorizedError } from "../Errors/HttpError";
import type { AuthorizeCheck } from "./metadata";

/**
 * A check that passes when any of `checks` passes (`@Authorize(a, b)` needs
 * all of them). Checks run in order and stop at the first that passes. When
 * none passes, the request is `401` if every check failed as "not signed in"
 * (`UnauthorizedError`, `JwtError`), otherwise `403`. Any other error of a
 * check is a bug and propagates unchanged.
 */
export function anyOf(...checks: AuthorizeCheck[]): AuthorizeCheck {
  if (checks.length === 0) throw new TypeError("anyOf() needs at least one check");
  return async (ctx) => {
    let unauthenticated: UnauthorizedError | undefined;
    let forbidden = false;
    for (const check of checks) {
      try {
        if (await check(ctx)) return true;
        forbidden = true;
      } catch (error) {
        if (error instanceof ForbiddenError) { forbidden = true; continue; }
        if (error instanceof UnauthorizedError) { unauthenticated ??= error; continue; }
        if (error instanceof JwtError) {
          if (unauthenticated === undefined) {
            unauthenticated = new UnauthorizedError();
            Object.defineProperty(unauthenticated, "cause", { value: error, configurable: true, writable: true });
          }
          continue;
        }
        throw error;
      }
    }
    if (forbidden) return false;
    throw unauthenticated ?? new UnauthorizedError();
  };
}
