import type { TechnologyDefinition } from '@scalelab/model';
import { exp, fixed, loadBalancerConfig } from '../defaults';
import { tech } from './clients';

export const loadBalancerTechnologies: TechnologyDefinition[] = [
  tech({
    id: 'aws-alb',
    name: 'AWS ALB',
    category: 'load-balancer',
    archetype: 'load-balancer',
    icon: 'amazonaws',
    brandColor: '#FF9900',
    description: 'AWS Application Load Balancer for HTTP and HTTPS traffic.',
    tags: ['aws', 'layer7', 'managed'],
    defaults: loadBalancerConfig({ strategy: 'least-connections', overhead: exp(2) }),
  }),
  tech({
    id: 'nginx',
    name: 'Nginx',
    category: 'load-balancer',
    archetype: 'load-balancer',
    icon: 'nginx',
    brandColor: '#009639',
    description: 'Web server and reverse proxy, often used as a load balancer.',
    tags: ['reverse-proxy', 'layer7', 'self-hosted'],
    defaults: loadBalancerConfig({ strategy: 'round-robin', overhead: fixed(1) }),
  }),
  tech({
    id: 'haproxy',
    name: 'HAProxy',
    category: 'load-balancer',
    archetype: 'load-balancer',
    icon: 'haproxy',
    brandColor: '#106DA9',
    description: 'High-performance TCP and HTTP load balancer.',
    tags: ['layer4', 'layer7', 'self-hosted'],
    defaults: loadBalancerConfig({ strategy: 'least-connections', overhead: fixed(1) }),
  }),
];
