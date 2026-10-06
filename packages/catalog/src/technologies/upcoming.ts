import type { TechnologyDefinition } from '@scalelab/model';
import { genericConfig } from '../defaults';
import { tech } from './clients';

/**
 * Groups you can draw around components (a Kubernetes cluster, an availability zone).
 * They organize the canvas; the engine doesn't simulate them yet.
 */
export const upcomingTechnologies: TechnologyDefinition[] = [
  tech({
    id: 'kubernetes-cluster',
    name: 'Kubernetes cluster',
    category: 'infrastructure',
    archetype: 'infra-group',
    icon: 'kubernetes',
    brandColor: '#326CE5',
    description: 'A group of nodes managed by Kubernetes. Drop services inside it.',
    tags: ['k8s', 'containers', 'group'],
    defaults: genericConfig(),
  }),
  tech({
    id: 'availability-zone',
    name: 'Availability zone',
    category: 'infrastructure',
    archetype: 'infra-group',
    icon: 'mappin',
    brandColor: '#64748B',
    description: 'An isolated data center location. Failing it fails everything inside.',
    tags: ['az', 'region', 'group'],
    defaults: genericConfig(),
  }),
];
