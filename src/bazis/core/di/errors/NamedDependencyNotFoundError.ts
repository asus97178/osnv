import { DiError } from "./DiError";

/** Returns a hint for a named dependency nobody registers, or `undefined`. */
export type NamedDependencyHint = (name: string) => string | undefined;

const hints: NamedDependencyHint[] = [];

/** Infrastructure extensions (ORM repositories, …) explain their own named dependencies here. */
export function registerNamedDependencyHint(hint: NamedDependencyHint): void {
  hints.push(hint);
}

export class NamedDependencyNotFoundError extends DiError {
  public constructor(name: string) {
    const hint = hints.map((item) => item(name)).find((text) => text !== undefined);
    super(`No provider token found for named dependency "${name}".${hint ? ` ${hint}` : ""}`);
  }
}
