import type { TechnologyDefinition } from '@scalelab/model';
import { clientConfig, isSimulated } from '../defaults';

type Entry = Omit<TechnologyDefinition, 'simulationSupported'>;

/** Adds `simulationSupported` from the archetype so it can never drift out of sync. */
export const tech = (entry: Entry): TechnologyDefinition => ({
  ...entry,
  simulationSupported: isSimulated(entry.archetype),
});

/**
 * Clients and frontends generate traffic. In the MVP a frontend is modeled as the
 * source of API requests from users' browsers; server-side rendering cost is added later.
 */
export const clientTechnologies: TechnologyDefinition[] = [
  tech({
    id: 'web-browser',
    name: 'Web browser',
    category: 'client',
    archetype: 'client',
    icon: 'googlechrome',
    brandColor: '#4285F4',
    description: 'Users visiting your site from a desktop or mobile browser.',
    tags: ['client', 'web'],
    defaults: clientConfig(),
  }),
  tech({
    id: 'mobile-app',
    name: 'Mobile app',
    category: 'client',
    archetype: 'client',
    icon: 'android',
    brandColor: '#3DDC84',
    description: 'A native iOS or Android app calling your APIs.',
    tags: ['client', 'mobile', 'ios', 'android'],
    defaults: clientConfig(),
  }),
  tech({
    id: 'nextjs',
    name: 'Next.js',
    category: 'frontend',
    archetype: 'client',
    icon: 'nextdotjs',
    brandColor: '#000000',
    description: 'React framework with routing, server rendering and API routes.',
    tags: ['react', 'typescript', 'ssr', 'vercel'],
    defaults: clientConfig(),
  }),
  tech({
    id: 'react',
    name: 'React',
    category: 'frontend',
    archetype: 'client',
    icon: 'react',
    brandColor: '#149ECA',
    description: 'Component-based UI library for single-page apps.',
    tags: ['javascript', 'typescript', 'spa'],
    defaults: clientConfig(),
  }),
  tech({
    id: 'vue',
    name: 'Vue',
    category: 'frontend',
    archetype: 'client',
    icon: 'vuedotjs',
    brandColor: '#42B883',
    description: 'Progressive framework for building user interfaces.',
    tags: ['javascript', 'typescript', 'spa'],
    defaults: clientConfig(),
  }),
  tech({
    id: 'angular',
    name: 'Angular',
    category: 'frontend',
    archetype: 'client',
    icon: 'angular',
    brandColor: '#DD0031',
    description: 'Full-featured TypeScript framework for large web apps.',
    tags: ['typescript', 'spa'],
    defaults: clientConfig(),
  }),
];
