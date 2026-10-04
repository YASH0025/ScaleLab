import type { Archetype, Category, LibraryDefinition, TechnologyDefinition } from '@scalelab/model';
import { libraries as libraryList } from './libraries';
import { backendTechnologies } from './technologies/backends';
import { clientTechnologies } from './technologies/clients';
import { dataTechnologies } from './technologies/data';
import { loadBalancerTechnologies } from './technologies/load-balancers';
import { messagingTechnologies, workerTechnologies } from './technologies/messaging';
import { upcomingTechnologies } from './technologies/upcoming';

export { SIMULATED_ARCHETYPES, isSimulated } from './defaults';

export const technologies: readonly TechnologyDefinition[] = [
  ...clientTechnologies,
  ...loadBalancerTechnologies,
  ...backendTechnologies,
  ...dataTechnologies,
  ...messagingTechnologies,
  ...workerTechnologies,
  ...upcomingTechnologies,
];

export const libraries: readonly LibraryDefinition[] = libraryList;

const techById = new Map(technologies.map((t) => [t.id, t]));
const libById = new Map(libraries.map((l) => [l.id, l]));

export function getTechnology(id: string): TechnologyDefinition | undefined {
  return techById.get(id);
}

export function getLibrary(id: string): LibraryDefinition | undefined {
  return libById.get(id);
}

/** Plugs straight into `validateDesign` from @scalelab/model. */
export function resolveArchetype(technologyId: string): Archetype | undefined {
  return techById.get(technologyId)?.archetype;
}

/** Libraries that can be attached to a technology, for the library picker. */
export function librariesFor(technologyId: string): LibraryDefinition[] {
  return libraries.filter((lib) => lib.compatibleWith.includes(technologyId));
}

/**
 * Soft warnings for a set of attached libraries, e.g. two state managers.
 * Returns pairs of conflicting library ids.
 */
export function libraryConflicts(libraryIds: string[]): Array<[string, string]> {
  const conflicts: Array<[string, string]> = [];
  for (let i = 0; i < libraryIds.length; i++) {
    for (let j = i + 1; j < libraryIds.length; j++) {
      const a = libraryIds[i]!;
      const b = libraryIds[j]!;
      if (getLibrary(a)?.conflictsWith.includes(b) || getLibrary(b)?.conflictsWith.includes(a)) {
        conflicts.push([a, b]);
      }
    }
  }
  return conflicts;
}

/** Technologies grouped by category, in catalog order, for the component library panel. */
export function technologiesByCategory(): Map<Category, TechnologyDefinition[]> {
  const groups = new Map<Category, TechnologyDefinition[]>();
  for (const t of technologies) {
    const list = groups.get(t.category) ?? [];
    list.push(t);
    groups.set(t.category, list);
  }
  return groups;
}

/** Case-insensitive search over name, id, category and tags. */
export function searchTechnologies(query: string): TechnologyDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...technologies];
  return technologies.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.id.includes(q) ||
      t.category.includes(q) ||
      t.tags.some((tag) => tag.includes(q)),
  );
}
