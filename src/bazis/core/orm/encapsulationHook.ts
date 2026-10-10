import { registerNamedDependencyEncapsulationHook } from "../di/module/encapsulationHooks";
import { registerNamedDependencyHint } from "../di/errors/NamedDependencyNotFoundError";
import { IRepository } from "./repository";

let registered = false;

/**
 * Allows closed `IRepository<Entity>` named deps when the module exports open
 * generic `IRepository`, and explains a repository nobody registers.
 */
export function registerRepositoryEncapsulationHook(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerNamedDependencyEncapsulationHook(({ depName, familiesVisible }) => {
    if (depName.startsWith("IRepository<") && familiesVisible.has(IRepository.id)) {
      return true;
    }
    return undefined;
  });

  registerNamedDependencyHint((name) => {
    const match = /^IRepository<(.+)>$/.exec(name);
    if (!match) return undefined;
    return `Repositories are registered by ormBazis for the entities of its context: add ${match[1]} to the entities of an ormBazis module and keep registerRepositories on (the default), or inject that module's DbContext instead.`;
  });
}
