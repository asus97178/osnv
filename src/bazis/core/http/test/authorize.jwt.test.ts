import { expect, test } from "bun:test";
import { Authorize, bearerToken, createAuthorizeComposer, UnauthorizedError, type AuthorizeCheck, type HttpContext } from "@/core/http";
import { errorHandler } from "../Middleware/errorHandler";
import { JwtExpiredError, JwtMalformedError, TokenIssuer, hs256 } from "@/library/jwt";

const issuer = new TokenIssuer({ issuer: "app", audience: "user", algorithm: hs256("test-only-secret-at-least-32-bytes!!"), accessTtlSeconds: 900, refreshTtlSeconds: 3600 });
const careless: AuthorizeCheck = async (ctx) => { await issuer.verifyAccess(bearerToken(ctx) ?? ""); return true; };
const context = (authorization?: string) => ({ header: (name: string) => (name === "authorization" ? authorization : undefined) }) as unknown as HttpContext;

function guard(check: AuthorizeCheck) {
  @Authorize(check)
  class Secured {}
  const [middleware] = createAuthorizeComposer()(Secured, "get", {} as never, {} as never);
  return (ctx: HttpContext): Promise<void> => Promise.resolve().then(() => middleware!(ctx, async () => {}));
}

test("a JWT error escaping an authorize check is 401, not 500", async () => {
  const middleware = guard(careless);
  for (const header of [undefined, "Bearer garbage"]) {
    const error = await middleware(context(header)).then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect((error as Error).cause).toBeInstanceOf(JwtMalformedError);
  }
  const expired = guard(() => { throw new JwtExpiredError(); });
  expect(await expired(context()).catch((caught: unknown) => caught)).toBeInstanceOf(UnauthorizedError);
  const bug = guard(() => { throw new TypeError("bug in check"); });
  expect(await bug(context()).catch((caught: unknown) => caught)).toBeInstanceOf(TypeError);
});

test("the 401 carries the Bearer challenge and is not logged as unexpected", async () => {
  const logged: unknown[] = [];
  const boundary = errorHandler({ logError: (error) => logged.push(error) });
  const ctx = { ...context("Bearer garbage"), response: undefined as Response | undefined };
  await boundary(ctx as never, () => guard(careless)(ctx as never));
  expect(ctx.response!.status).toBe(401);
  expect(ctx.response!.headers.get("www-authenticate")).toBe("Bearer");
  expect(await ctx.response!.json()).toEqual({ error: "Unauthorized" });
  expect(logged).toEqual([]);
});

test("bearerToken reads the token of an Authorization: Bearer header", () => {
  expect(bearerToken(context("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
  expect(bearerToken(context("bearer   abc  "))).toBe("abc");
  expect(bearerToken(context("Bearer "))).toBeUndefined();
  expect(bearerToken(context("Basic dXNlcjpwYXNz"))).toBeUndefined();
  expect(bearerToken(context())).toBeUndefined();
});
