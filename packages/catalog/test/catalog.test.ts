import {
  LibraryDefinitionSchema,
  TechnologyDefinitionSchema,
  expectedConfigType,
} from '@scalelab/model';
import { describe, expect, it } from 'vitest';
import {
  SIMULATED_ARCHETYPES,
  getTechnology,
  libraries,
  librariesFor,
  libraryConflicts,
  resolveArchetype,
  searchTechnologies,
  technologies,
  technologiesByCategory,
} from '../src';

describe('technology catalog', () => {
  it('every entry matches the schema', () => {
    for (const t of technologies) {
      const result = TechnologyDefinitionSchema.safeParse(t);
      expect(result.success, `${t.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = technologies.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each technology's default config matches its archetype", () => {
    for (const t of technologies) {
      expect(t.defaults.type, t.id).toBe(expectedConfigType(t.archetype));
    }
  });

  it('marks only MVP archetypes as simulated', () => {
    for (const t of technologies) {
      expect(t.simulationSupported, t.id).toBe(SIMULATED_ARCHETYPES.includes(t.archetype));
    }
  });

  it('covers every MVP archetype with at least one technology', () => {
    for (const archetype of SIMULATED_ARCHETYPES) {
      expect(technologies.some((t) => t.archetype === archetype), archetype).toBe(true);
    }
  });

  it('ships every default as a healthy component', () => {
    for (const t of technologies) {
      expect(t.defaults.available, t.id).toBe(true);
      expect(t.defaults.extraLatencyMs, t.id).toBe(0);
    }
  });

  it('prices every simulated technology', () => {
    for (const t of technologies) {
      if (t.simulationSupported) expect(t.pricing, t.id).toBeDefined();
    }
    expect(getTechnology('nextjs')?.pricing).toEqual({ kind: 'free' });
    expect(getTechnology('mongodb')?.pricing).toBeUndefined();
  });

  it('resolves archetypes and lookups', () => {
    expect(resolveArchetype('postgresql')).toBe('relational-db');
    expect(resolveArchetype('does-not-exist')).toBeUndefined();
    expect(getTechnology('spring-boot')?.name).toBe('Spring Boot');
  });

  it('groups technologies by category', () => {
    const groups = technologiesByCategory();
    expect(groups.get('backend')?.map((t) => t.id)).toContain('nestjs');
  });

  it('searches by name, tag and category', () => {
    expect(searchTechnologies('spring').map((t) => t.id)).toContain('spring-boot');
    expect(searchTechnologies('python').map((t) => t.id)).toEqual(expect.arrayContaining(['django', 'fastapi']));
    expect(searchTechnologies('cache').every((t) => t.category === 'cache' || t.tags.includes('cache'))).toBe(true);
    expect(searchTechnologies('').length).toBe(technologies.length);
  });
});

describe('library catalog', () => {
  it('every entry matches the schema', () => {
    for (const lib of libraries) {
      const result = LibraryDefinitionSchema.safeParse(lib);
      expect(result.success, `${lib.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = libraries.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only references technologies that exist', () => {
    for (const lib of libraries) {
      for (const techId of lib.compatibleWith) {
        expect(getTechnology(techId), `${lib.id} → ${techId}`).toBeDefined();
      }
    }
  });

  it('only declares conflicts with libraries that exist, symmetrically', () => {
    const ids = new Set(libraries.map((l) => l.id));
    for (const lib of libraries) {
      for (const other of lib.conflictsWith) {
        expect(ids.has(other), `${lib.id} → ${other}`).toBe(true);
        expect(libraries.find((l) => l.id === other)?.conflictsWith, `${other} ↔ ${lib.id}`).toContain(lib.id);
      }
    }
  });

  it('offers the right libraries for a technology', () => {
    const forNext = librariesFor('nextjs').map((l) => l.id);
    expect(forNext).toEqual(expect.arrayContaining(['tailwind-css', 'zustand', 'tanstack-query', 'nextauth']));
    expect(forNext).not.toContain('spring-data-jpa');
    expect(librariesFor('spring-boot').map((l) => l.id)).toContain('resilience4j');
  });

  it('detects overlapping libraries', () => {
    expect(libraryConflicts(['zustand', 'tailwind-css', 'redux-toolkit'])).toEqual([['zustand', 'redux-toolkit']]);
    expect(libraryConflicts(['tailwind-css', 'zustand'])).toEqual([]);
  });
});
