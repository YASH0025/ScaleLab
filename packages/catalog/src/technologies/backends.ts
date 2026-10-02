import type { TechnologyDefinition } from '@scalelab/model';
import { computeConfig, logn } from '../defaults';
import { tech } from './clients';

/**
 * Backend defaults describe one typical API request (business logic + serialization),
 * not including database or cache time, which the flow adds separately.
 * workersPerInstance approximates how many requests one instance processes at once.
 */
export const backendTechnologies: TechnologyDefinition[] = [
  tech({
    id: 'spring-boot',
    name: 'Spring Boot',
    category: 'backend',
    archetype: 'compute-service',
    icon: 'springboot',
    brandColor: '#6DB33F',
    description: 'Java framework for production-ready services.',
    tags: ['java', 'jvm', 'rest'],
    defaults: computeConfig({ workersPerInstance: 200, serviceTime: logn(30, 120) }),
  }),
  tech({
    id: 'nestjs',
    name: 'NestJS',
    category: 'backend',
    archetype: 'compute-service',
    icon: 'nestjs',
    brandColor: '#E0234E',
    description: 'Structured Node.js framework with modules and dependency injection.',
    tags: ['nodejs', 'typescript', 'rest'],
    defaults: computeConfig({ workersPerInstance: 100, serviceTime: logn(25, 110) }),
  }),
  tech({
    id: 'express',
    name: 'Express',
    category: 'backend',
    archetype: 'compute-service',
    icon: 'express',
    brandColor: '#000000',
    description: 'Minimal, widely used Node.js web framework.',
    tags: ['nodejs', 'javascript', 'rest'],
    defaults: computeConfig({ workersPerInstance: 100, serviceTime: logn(20, 100) }),
  }),
  tech({
    id: 'django',
    name: 'Django',
    category: 'backend',
    archetype: 'compute-service',
    icon: 'django',
    brandColor: '#0C4B33',
    description: 'Batteries-included Python web framework.',
    tags: ['python', 'rest'],
    defaults: computeConfig({ workersPerInstance: 16, serviceTime: logn(45, 180) }),
  }),
  tech({
    id: 'fastapi',
    name: 'FastAPI',
    category: 'backend',
    archetype: 'compute-service',
    icon: 'fastapi',
    brandColor: '#009688',
    description: 'Async Python framework for building APIs.',
    tags: ['python', 'async', 'rest'],
    defaults: computeConfig({ workersPerInstance: 64, serviceTime: logn(25, 110) }),
  }),
  tech({
    id: 'go-gin',
    name: 'Go · Gin',
    category: 'backend',
    archetype: 'compute-service',
    icon: 'go',
    brandColor: '#00ADD8',
    description: 'Fast HTTP framework for Go.',
    tags: ['go', 'rest'],
    defaults: computeConfig({ workersPerInstance: 500, serviceTime: logn(10, 50) }),
  }),
  tech({
    id: 'aspnet-core',
    name: 'ASP.NET Core',
    category: 'backend',
    archetype: 'compute-service',
    icon: 'dotnet',
    brandColor: '#512BD4',
    description: 'Cross-platform .NET framework for web APIs.',
    tags: ['csharp', 'dotnet', 'rest'],
    defaults: computeConfig({ workersPerInstance: 200, serviceTime: logn(20, 90) }),
  }),
];
