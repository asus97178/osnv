import { expect, test } from "bun:test";
import { buildDynamicModel, DbContext, DbContextOptions, EntityNotMappedError, type DatabaseProvider } from "../index";

const provider = { name: "test", dialect: { name: "test" } } as unknown as DatabaseProvider;
class AppDb extends DbContext {}

test("several isKey fields point to primaryKey for a composite key", () => {
  expect(() => buildDynamicModel({ name: "Pairs", fields: [{ name: "a", type: "int", isKey: true }, { name: "b", type: "int", isKey: true }] })).toThrow(
    'Dynamic table "Pairs" declares several isKey fields ("a", "b"). Mark one field with isKey, or for a composite key use primaryKey: { properties: ["a", "b"] }.',
  );
  expect(() => buildDynamicModel({ name: "Pairs", fields: [{ name: "a", type: "int" }] })).toThrow(
    'Dynamic table "Pairs" has no primary key. Mark one field with isKey, or set primaryKey: { properties: [...] }.',
  );
});

test("an unknown dynamic set name explains how to register a dynamic model", () => {
  const db = new AppDb(new DbContextOptions({ provider, entities: [] }));
  let error: unknown;
  try { db.setByName("Tickets"); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(EntityNotMappedError);
  expect((error as Error).message).toBe('No entity or dynamic model named "Tickets" is registered in this DbContext. Register a dynamic table first: options.model.registerModel(buildDynamicModel({ name: "Tickets", fields: [...] })).');
});

test("a plain object added through the context points to setByName", () => {
  const options = new DbContextOptions({ provider, entities: [] });
  options.model.registerModel(buildDynamicModel({ name: "Tickets", fields: [{ name: "id", type: "int", isKey: true }] }));
  const db = new AppDb(options);
  for (const row of [{ title: "x" }, Object.assign(Object.create(null), { title: "x" })]) {
    expect(() => db.add(row)).toThrow(EntityNotMappedError);
    expect(() => db.add(row)).toThrow('A plain object is not an entity class. For a dynamic table add the row through its set: db.setByName("Table").add(row).');
  }
  expect(db.setByName("Tickets").add({ title: "x" })).toEqual({ title: "x" });
});
