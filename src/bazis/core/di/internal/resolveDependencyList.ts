import type { ProviderDependencyList } from "../provider";
import type { ServiceResolver } from "../types";

/** @internal A resolver created by ServiceProvider resolves a dependency list in its own scope. */
export const RESOLVE_DEPENDENCY_LIST = Symbol("bazis.di.resolveDependencyList");

type ListResolver = ServiceResolver & { readonly [RESOLVE_DEPENDENCY_LIST]?: (key: object, deps: ProviderDependencyList) => unknown[] };

/**
 * Resolves `deps` (tokens, keyed, named, lazy or optional dependencies, as
 * codegen records them) in the scope of `resolver`. `key` identifies the list
 * so its resolution plan is built once. For framework factories that construct
 * a class with generated dependencies, such as a DbContext.
 */
export function resolveDependencyList(resolver: ServiceResolver, key: object, deps: ProviderDependencyList): unknown[] {
  const resolve = (resolver as ListResolver)[RESOLVE_DEPENDENCY_LIST];
  if (resolve === undefined) throw new TypeError("resolveDependencyList() needs a resolver created by the container");
  return resolve(key, deps);
}
