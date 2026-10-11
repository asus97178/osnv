import { expect, test } from "bun:test";
import { anyOf, Authorize, createAuthorizeComposer, ForbiddenError, UnauthorizedError, type AuthorizeCheck, type HttpContext } from "@/core/http";
import { JwtExpiredError } from "@/library/jwt";

const ctx = {} as HttpContext;
const yes: AuthorizeCheck = () => true;
const no: AuthorizeCheck = () => false;
const anonymous: AuthorizeCheck = () => { throw new UnauthorizedError(); };
const expired: AuthorizeCheck = () => { throw new JwtExpiredError(); };
const bug: AuthorizeCheck = () => { throw new TypeError("bug in check"); };
const outcome = (check: AuthorizeCheck) => Promise.resolve().then(() => check(ctx)).then((value) => value, (error: unknown) => error);

test("anyOf passes when any check passes and stops there", async () => {
  const calls: string[] = [];
  const track = (name: string, result: boolean): AuthorizeCheck => () => { calls.push(name); return result; };
  expect(await outcome(anyOf(track("a", false), track("b", true), track("c", true)))).toBe(true);
  expect(calls).toEqual(["a", "b"]);
  expect(await outcome(anyOf(anonymous, yes))).toBe(true);
});

test("no credentials at all is 401; signed in but not allowed is 403", async () => {
  expect(await outcome(anyOf(anonymous, expired))).toBeInstanceOf(UnauthorizedError);
  expect(await outcome(anyOf(anonymous, no))).toBe(false);
  expect(await outcome(anyOf(no, () => { throw new ForbiddenError(); }))).toBe(false);
});

test("an unexpected error of a check is not hidden", async () => {
  expect(await outcome(anyOf(no, bug, yes))).toBeInstanceOf(TypeError);
  expect(() => anyOf()).toThrow("anyOf() needs at least one check");
});

test("anyOf in @Authorize answers 401 or 403 accordingly", async () => {
  const run = async (check: AuthorizeCheck) => {
    @Authorize(check)
    class Secured {}
    const [middleware] = createAuthorizeComposer()(Secured, "get", {} as never, {} as never);
    return Promise.resolve().then(() => middleware!(ctx, async () => {})).then(() => "passed", (error: unknown) => error);
  };
  expect(await run(anyOf(anonymous, expired))).toBeInstanceOf(UnauthorizedError);
  expect(await run(anyOf(anonymous, no))).toBeInstanceOf(ForbiddenError);
  expect(await run(anyOf(no, yes))).toBe("passed");
});
