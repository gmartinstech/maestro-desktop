// engine/src/apps/swarm/exportable.ts -- SUB-3, a full TypeScript port of
// backend/apps/swarm/exportable.py.
//
// The one abstraction every shareable thing implements. Export walks dependencies() into a
// closure; import calls import_() leaves-first, rewiring cross-refs through the RemapTable.
// Secret redaction is centralized in closure + ziputil so a new entity physically can't forget to
// scrub itself.
//
// This supersedes apps/skills/swarmSkillEntity.ts's own local, NARROWLY-SCOPED stand-ins for
// these same shapes (RemapTable/EntityType/Requirement/DepRef/ExportContext) -- that file's own
// header said so explicitly ("SUB-3 should reconcile these with its own full swarm/models.ts +
// swarm/exportable.ts once it lands"). swarmSkillEntity.ts has been updated to import the real
// types from here instead of keeping its own copies.

import type { EntityType, Requirement } from './models';

/** A local reference one entity holds to another, before bundling. */
export interface DepRef {
  type: EntityType;
  local_id: string;
  relation: string;
}

export function depRef(type: EntityType, localId: string, relation = ''): DepRef {
  return { type, local_id: localId, relation };
}

/** Lets an entity rewrite its own cross-refs from local ids to bundle ids. */
export interface ExportContext {
  bundleIdFor(etype: EntityType, localId: string): string | null;
}

/** bundle_id -> fresh local id, filled as import walks entities leaves-first. */
export class RemapTable {
  private readonly m = new Map<string, string>();

  assign(bundleId: string, localId: string): void {
    this.m.set(bundleId, localId);
  }

  local(bundleId: string): string | null {
    return this.m.get(bundleId) ?? null;
  }
}

/** Every entity type (skill/app/workflow/mode/session/dashboard) implements this shape. Modeled as
 * a TS interface + a companion "class implementing it" convention rather than Python's
 * runtime_checkable Protocol -- registry.ts's REGISTRY map is the actual type-safety chokepoint
 * (each entry's static shape is checked structurally at the call site), so there is no need for a
 * runtime isinstance-equivalent check anywhere in this port. */
export interface Exportable {
  readonly type: EntityType;
  readonly localId: string;
  readonly name: string;
  // Return type is the broad `object` (not `Record<string, unknown>`) deliberately: a concrete
  // entity's own payload shape (e.g. skills' SkillExportPayload) is a named interface with no
  // index signature, and TypeScript does not consider that assignable to `Record<string, unknown>`
  // even though every payload here is, at runtime, exactly that -- `object` is the narrowest common
  // supertype that avoids forcing every entity to add a redundant index signature just to satisfy
  // this interface. Every caller (closure.ts's scrubPayload/JSON.stringify) treats the result as
  // opaque JSON-shaped data regardless.
  serialize(ctx: ExportContext): object;
  files(): Record<string, Buffer>;
  dependencies(): DepRef[];
  requirements(): Requirement[];
}

/** Static side of Exportable -- every entity class exposes these as static members. TypeScript
 * has no direct way to require statics through an instance interface, so registry.ts's REGISTRY
 * value type spells this out explicitly instead. */
export interface ExportableClass {
  load(localId: string): Exportable | null;
  import_(payload: Record<string, unknown>, files: Record<string, Buffer>, remap: RemapTable | null): string;
  /** Optional: a conflict-detection hint shown at import preflight (only skills implement this
   * today). Optional: a post-commit undo hook for the all-or-nothing rollback in closure.ts's
   * commit(). */
  conflict?(payload: Record<string, unknown>): string | null;
  rollback?(localId: string): void;
}
