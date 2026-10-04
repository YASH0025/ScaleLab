import type { RepoFile } from '../src';

const json = (o: unknown) => JSON.stringify(o, null, 2);
const files = (o: Record<string, string>): RepoFile[] => Object.entries(o).map(([path, content]) => ({ path, content }));

/** A Node shop: Nginx, a Next.js frontend, a NestJS API, a Kafka consumer, Postgres, Redis and Kafka. */
export const nodeShop = files({
  'package.json': json({ name: 'shop', private: true, workspaces: ['web', 'api', 'worker'], devDependencies: { turbo: '^2.0.0' } }),
  'docker-compose.yml': `
services:
  nginx:
    image: nginx:1.27-alpine
    ports: ["80:80"]
    depends_on: [web, api]
  web:
    build: ./web
    ports: ["3000:3000"]
    environment:
      NEXT_PUBLIC_API_URL: http://api:4000
    depends_on: [api]
  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    ports: ["4000:4000"]
    environment:
      - DATABASE_URL=postgres://shop:shop@db:5432/shop
      - REDIS_URL=redis://cache:6379
      - KAFKA_BROKERS=kafka:9092
      - STRIPE_SECRET_KEY=sk_test_123
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
      kafka:
        condition: service_started
    deploy:
      replicas: 3
  worker:
    build: ./worker
    command: ["node", "dist/consumer.js"]
    environment:
      KAFKA_BROKERS: kafka:9092
      DATABASE_URL: postgres://shop:shop@db:5432/shop
      SENDGRID_API_KEY: SG.test
    depends_on: [kafka, db]
  db:
    image: postgres:16-alpine
  cache:
    image: redis:7
  zookeeper:
    image: confluentinc/cp-zookeeper:7.6.0
  kafka:
    image: confluentinc/cp-kafka:7.6.0
    depends_on: [zookeeper]
  mailhog:
    image: mailhog/mailhog
`,
  'web/package.json': json({
    name: '@shop/web',
    dependencies: { next: '15.0.0', react: '19.0.0', 'react-dom': '19.0.0', '@tanstack/react-query': '^5.0.0' },
    devDependencies: { tailwindcss: '^4.0.0' },
  }),
  'api/package.json': json({
    name: '@shop/api',
    dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0', '@prisma/client': '^5.0.0', ioredis: '^5.0.0', kafkajs: '^2.0.0', stripe: '^16.0.0', passport: '^0.7.0' },
    devDependencies: { prisma: '^5.0.0' },
  }),
  'api/prisma/schema.prisma': `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`,
  'worker/package.json': json({ name: '@shop/worker', dependencies: { kafkajs: '^2.0.0', pg: '^8.0.0', '@sendgrid/mail': '^8.0.0' } }),
});

/** Django with Celery workers on Redis. */
export const djangoCelery = files({
  'docker-compose.yml': `
services:
  web:
    build: .
    command: gunicorn shop.wsgi:application --bind 0.0.0.0:8000
    ports:
      - "8000:8000"
    env_file: .env
    depends_on:
      - db
      - redis
  worker:
    build: .
    command: celery -A shop worker -l info
    env_file: .env
    depends_on: [redis, db]
  beat:
    build: .
    command: celery -A shop beat -l info
  db:
    image: postgres:15
  redis:
    image: redis:7-alpine
`,
  '.env': `
# Local settings
DATABASE_URL=postgres://app:secret@db:5432/app
CELERY_BROKER_URL=redis://redis:6379/0
DEBUG=true
`,
  'requirements.txt': `
Django==5.0.6  # web
celery[redis]==5.4.0
psycopg2-binary>=2.9
redis
stripe==9.0.0
gunicorn
-r requirements-dev.txt
`,
});

/** Two services without docker-compose: Spring Boot and Go, sharing Postgres and Kafka. */
export const polyglot = files({
  'orders-service/pom.xml': `<?xml version="1.0"?>
<project>
  <artifactId>orders-service</artifactId>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
    <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId></dependency>
    <dependency><groupId>org.springframework.kafka</groupId><artifactId>spring-kafka</artifactId></dependency>
    <dependency><groupId>io.github.resilience4j</groupId><artifactId>resilience4j-spring-boot3</artifactId></dependency>
  </dependencies>
</project>`,
  'inventory/go.mod': `module github.com/acme/inventory/v2

go 1.22

require (
\tgithub.com/gin-gonic/gin v1.10.0
\tgithub.com/jackc/pgx/v5 v5.6.0 // indirect
\tgithub.com/segmentio/kafka-go v0.4.47
)

require github.com/redis/go-redis/v9 v9.5.1
`,
  'inventory/.env.example': 'REDIS_URL=redis://localhost:6379\n',
});

/** A full-stack Next.js app: pages and API routes in one project. */
export const nextFullStack = files({
  'package.json': json({
    name: 'saas-starter',
    dependencies: { next: '15.0.0', react: '19.0.0', 'react-dom': '19.0.0', '@prisma/client': '^5.0.0', 'next-auth': '^4.0.0', stripe: '^16.0.0', zod: '^3.0.0' },
    devDependencies: { prisma: '^5.0.0', tailwindcss: '^4.0.0' },
  }),
  'prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n',
});

/** Flask with Poetry, and an ASP.NET Core service. */
export const flaskAndDotnet = files({
  'api/pyproject.toml': `
[tool.poetry]
name = "api"

[tool.poetry.dependencies]
python = "^3.12"
Flask = "^3.0"
SQLAlchemy = "^2.0"
pymongo = "^4.7"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"
`,
  'billing/Billing.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="8.0.0" />
    <PackageReference Include="StackExchange.Redis" Version="2.7.0" />
    <PackageReference Include="Stripe.net" Version="45.0.0" />
  </ItemGroup>
</Project>`,
  'tools/package.json': json({ name: 'tools', dependencies: { chalk: '^5.0.0' } }),
});
