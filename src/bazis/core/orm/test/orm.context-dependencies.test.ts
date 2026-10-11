import { expect, test } from "bun:test";
import { createContainer, Module, scoped } from "@/core/di";
import { registerGeneratedClassDeps } from "@/core/di/module/autoDeps";
import { DbContext, DbContextOptions, ormModule, type DatabaseProvider } from "@/core/orm";

const provider = { name: "test", dialect: { name: "test" }, query: async () => [], execute: async () => ({ changes: 0, lastInsertId: 0 }), transaction: async <T>(work: never) => work as T, ping: async () => true, close: async () => undefined, introspect: async () => ({ tables: new Map() }) } as unknown as DatabaseProvider;

export class CurrentTenant { id = ""; }
class TenantDb extends DbContext {
  constructor(options: DbContextOptions, readonly tenant: CurrentTenant) { super(options); }
}
registerGeneratedClassDeps(TenantDb, [DbContextOptions, CurrentTenant]);
class PlainDb extends DbContext {}
registerGeneratedClassDeps(PlainDb, [DbContextOptions]);

test("a DbContext constructor gets its other dependencies from the request scope", () => {
  @Module({ providers: [scoped(CurrentTenant)], exports: [CurrentTenant] })
  class TenantModule {}
  @Module({ imports: [ormModule({ provider, healthCheck: false }), TenantModule], ormBazis: [{ context: TenantDb, entities: [], imports: [TenantModule] }, { context: PlainDb, entities: [] }], exports: [] })
  class AppModule {}
  const container = createContainer(AppModule);
  const first = container.createScope(); const second = container.createScope();
  first.resolve(CurrentTenant).id = "acme";
  second.resolve(CurrentTenant).id = "globex";
  expect(first.resolve(TenantDb).tenant.id).toBe("acme");
  expect(first.resolve(TenantDb).tenant).toBe(first.resolve(CurrentTenant));
  expect(second.resolve(TenantDb).tenant.id).toBe("globex");
  expect(first.resolve(PlainDb)).toBeInstanceOf(PlainDb);
});

test("a DbContext whose first constructor parameter is not DbContextOptions is named", () => {
  class WrongDb extends DbContext { constructor(readonly tenant: CurrentTenant, options: DbContextOptions) { super(options); } }
  registerGeneratedClassDeps(WrongDb, [CurrentTenant, DbContextOptions]);
  @Module({ imports: [ormModule({ provider, healthCheck: false })], providers: [scoped(CurrentTenant)], ormBazis: { context: WrongDb as never, entities: [] }, exports: [] })
  class AppModule {}
  expect(() => createContainer(AppModule).createScope().resolve(WrongDb)).toThrow('WrongDb: the first constructor parameter of a DbContext must be DbContextOptions; put its other dependencies after it.');
});
