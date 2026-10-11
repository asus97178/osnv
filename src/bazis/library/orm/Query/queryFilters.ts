import type { EntityModel } from "../Metadata/types";
import { evaluatePredicate, type Condition, type FieldSelector } from "./conditions";

/**
 * The query filters of `model` for a query of `context`: the fixed ones plus
 * the context filters evaluated now. A context filter that throws fails the
 * query; it never runs without the filter.
 */
export function effectiveQueryFilters(model: EntityModel, context: object | undefined): readonly Condition[] {
  const dynamic = model.contextQueryFilters ?? [];
  if (dynamic.length === 0) return model.queryFilters;
  return [
    ...model.queryFilters,
    ...dynamic.map((filter) => evaluatePredicate((entity) => filter(entity as FieldSelector<never>, context as never), "@QueryFilter").node),
  ];
}
