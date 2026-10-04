import type { Kind } from './types';

/**
 * What a dependency tells us about a project. One package can say several things:
 * `kafkajs` means "talks to Kafka" and also "uses the KafkaJS library".
 */
export interface Signal {
  /** A backend web framework (compute service). */
  framework?: string;
  /** A frontend or app (client). */
  frontend?: string;
  /** A worker framework, like Celery. */
  worker?: string;
  /** Something it talks to. */
  uses?: Kind;
  /** A catalog library to attach. */
  library?: string;
  /** Said when the technology is a stand-in. */
  note?: string;
  /** A tool rather than part of the running app, like a load generator. */
  tool?: string;
  /** A gRPC server: a service when no web framework says otherwise. */
  grpc?: string;
}

type Table = Array<[names: string[], signal: Signal]>;

const similar = (name: string, as: string, kind: string) => `${name} is modeled as ${as} (a similar ${kind}).`;

const NODE: Table = [
  [['@nestjs/core'], { framework: 'nestjs' }],
  [['express'], { framework: 'express' }],
  [['fastify'], { framework: 'express', note: similar('Fastify', 'Express', 'Node web server') }],
  [['koa'], { framework: 'express', note: similar('Koa', 'Express', 'Node web server') }],
  [['@hapi/hapi'], { framework: 'express', note: similar('hapi', 'Express', 'Node web server') }],
  [['hono'], { framework: 'express', note: similar('Hono', 'Express', 'Node web server') }],
  [['next'], { frontend: 'nextjs' }],
  [['nuxt'], { frontend: 'vue', note: similar('Nuxt', 'Vue', 'frontend') }],
  [['vue'], { frontend: 'vue' }],
  [['@angular/core'], { frontend: 'angular' }],
  [['react-dom'], { frontend: 'react' }],
  [['react-native', 'expo'], { frontend: 'mobile-app' }],
  [['@grpc/grpc-js', 'grpc'], { grpc: 'express' }],
  [['k6', 'artillery', 'autocannon'], { tool: 'a load-testing tool' }],

  [['pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres', 'pg-promise'], { uses: 'postgres' }],
  [['mysql', 'mysql2', 'mariadb'], { uses: 'mysql' }],
  [['mongodb', 'mongoose'], { uses: 'mongodb' }],
  [['ioredis'], { uses: 'redis', library: 'ioredis' }],
  [['redis', '@redis/client', '@upstash/redis'], { uses: 'redis' }],
  [['memjs', 'memcached'], { uses: 'memcached' }],
  [['kafkajs'], { uses: 'kafka', library: 'kafkajs' }],
  [['@confluentinc/kafka-javascript', 'node-rdkafka'], { uses: 'kafka' }],
  [['amqplib'], { uses: 'rabbitmq', library: 'amqplib' }],
  [['amqp-connection-manager'], { uses: 'rabbitmq' }],
  [['@aws-sdk/client-sqs', 'sqs-consumer', 'sqs-producer'], { uses: 'sqs' }],
  [['bullmq', 'bull', 'bee-queue', '@nestjs/bull', '@nestjs/bullmq'], { uses: 'jobs' }],
  [['@aws-sdk/client-s3'], { uses: 's3' }],
  [['stripe'], { uses: 'stripe' }],
  [['@paypal/checkout-server-sdk', '@paypal/paypal-server-sdk'], { uses: 'paypal' }],
  [['razorpay'], { uses: 'razorpay' }],
  [['twilio'], { uses: 'twilio' }],
  [['@sendgrid/mail'], { uses: 'sendgrid' }],
  [['openai'], { uses: 'openai' }],
  [['auth0', '@auth0/nextjs-auth0', 'express-openid-connect', 'express-oauth2-jwt-bearer'], { uses: 'auth0' }],
  [['@clerk/nextjs', '@clerk/express', '@clerk/clerk-sdk-node', '@clerk/backend', '@clerk/clerk-react'], { uses: 'clerk' }],

  [['prisma', '@prisma/client'], { library: 'prisma' }],
  [['typeorm'], { library: 'typeorm' }],
  [['passport'], { library: 'passport' }],
  [['zod'], { library: 'zod' }],
  [['@opentelemetry/sdk-node'], { library: 'opentelemetry-sdk' }],
  [['tailwindcss'], { library: 'tailwind-css' }],
  [['@mui/material'], { library: 'mui' }],
  [['zustand'], { library: 'zustand' }],
  [['@reduxjs/toolkit'], { library: 'redux-toolkit' }],
  [['@tanstack/react-query'], { library: 'tanstack-query' }],
  [['swr'], { library: 'swr' }],
  [['next-auth'], { library: 'nextauth' }],
  [['framer-motion', 'motion'], { library: 'motion' }],
];

const PYTHON: Table = [
  [['django'], { framework: 'django' }],
  [['fastapi'], { framework: 'fastapi' }],
  [['flask'], { framework: 'fastapi', note: similar('Flask', 'FastAPI', 'Python web server') }],
  [['starlette', 'litestar', 'sanic'], { framework: 'fastapi', note: 'This Python web server is modeled as FastAPI.' }],
  [['celery'], { worker: 'celery' }],
  [['grpcio'], { grpc: 'fastapi' }],
  [['locust'], { tool: 'a load-testing tool (Locust)' }],
  [['rq'], { worker: 'background-worker', uses: 'jobs' }],

  [['psycopg2', 'psycopg2-binary', 'psycopg', 'psycopg-binary', 'asyncpg'], { uses: 'postgres' }],
  [['mysqlclient', 'pymysql', 'aiomysql', 'mysql-connector-python'], { uses: 'mysql' }],
  [['pymongo', 'motor', 'mongoengine', 'beanie'], { uses: 'mongodb' }],
  [['redis', 'aioredis'], { uses: 'redis' }],
  [['pymemcache', 'python-memcached'], { uses: 'memcached' }],
  [['kafka-python', 'confluent-kafka', 'aiokafka'], { uses: 'kafka' }],
  [['pika', 'aio-pika'], { uses: 'rabbitmq' }],
  [['stripe'], { uses: 'stripe' }],
  [['paypalrestsdk', 'paypal-server-sdk'], { uses: 'paypal' }],
  [['razorpay'], { uses: 'razorpay' }],
  [['twilio'], { uses: 'twilio' }],
  [['sendgrid'], { uses: 'sendgrid' }],
  [['openai'], { uses: 'openai' }],
  [['auth0-python'], { uses: 'auth0' }],
  [['sqlalchemy'], { library: 'sqlalchemy' }],
];

const JAVA: Table = [
  [['spring-boot-starter-web', 'spring-boot-starter-webflux'], { framework: 'spring-boot' }],
  [['quarkus-resteasy', 'quarkus-rest', 'quarkus-resteasy-reactive'], { framework: 'spring-boot', note: similar('Quarkus', 'Spring Boot', 'Java web server') }],
  [['micronaut-http-server-netty'], { framework: 'spring-boot', note: similar('Micronaut', 'Spring Boot', 'Java web server') }],
  [['grpc-netty', 'grpc-netty-shaded', 'grpc-services', 'grpc-spring-boot-starter', 'grpc-server-spring-boot-starter'], { grpc: 'spring-boot' }],
  [['spring-kafka'], { uses: 'kafka', library: 'spring-kafka' }],
  [['kafka-clients'], { uses: 'kafka' }],
  [['spring-boot-starter-amqp'], { uses: 'rabbitmq', library: 'spring-amqp' }],
  [['amqp-client'], { uses: 'rabbitmq' }],
  [['spring-boot-starter-data-redis'], { uses: 'redis', library: 'lettuce' }],
  [['jedis', 'lettuce-core', 'redisson'], { uses: 'redis' }],
  [['postgresql', 'r2dbc-postgresql'], { uses: 'postgres' }],
  [['mysql-connector-j', 'mysql-connector-java', 'mariadb-java-client'], { uses: 'mysql' }],
  [['spring-boot-starter-data-mongodb', 'mongodb-driver-sync', 'mongodb-driver-reactivestreams'], { uses: 'mongodb' }],
  [['sqs'], { uses: 'sqs' }],
  [['s3'], { uses: 's3' }],
  [['stripe-java'], { uses: 'stripe' }],
  [['twilio'], { uses: 'twilio' }],
  [['sendgrid-java'], { uses: 'sendgrid' }],
  [['spring-boot-starter-data-jpa'], { library: 'spring-data-jpa' }],
  [['spring-boot-starter-security'], { library: 'spring-security' }],
  [['resilience4j-spring-boot3', 'resilience4j-spring-boot2', 'resilience4j-circuitbreaker'], { library: 'resilience4j' }],
  [['HikariCP'], { library: 'hikaricp' }],
];

const GO: Table = [
  [['github.com/gin-gonic/gin'], { framework: 'go-gin' }],
  [['github.com/labstack/echo/v4', 'github.com/labstack/echo'], { framework: 'go-gin', note: similar('Echo', 'Gin', 'Go web server') }],
  [['github.com/gofiber/fiber/v2', 'github.com/gofiber/fiber/v3'], { framework: 'go-gin', note: similar('Fiber', 'Gin', 'Go web server') }],
  [['github.com/go-chi/chi/v5', 'github.com/go-chi/chi'], { framework: 'go-gin', note: similar('chi', 'Gin', 'Go web server') }],
  [['github.com/gorilla/mux'], { framework: 'go-gin', note: similar('gorilla/mux', 'Gin', 'Go web server') }],
  [['google.golang.org/grpc'], { grpc: 'go-gin' }],
  [['github.com/jackc/pgx/v5', 'github.com/jackc/pgx/v4', 'github.com/lib/pq'], { uses: 'postgres' }],
  [['github.com/go-sql-driver/mysql'], { uses: 'mysql' }],
  [['go.mongodb.org/mongo-driver', 'go.mongodb.org/mongo-driver/v2'], { uses: 'mongodb' }],
  [['github.com/redis/go-redis/v9', 'github.com/go-redis/redis/v8', 'github.com/go-redis/redis'], { uses: 'redis' }],
  [['github.com/IBM/sarama', 'github.com/Shopify/sarama', 'github.com/segmentio/kafka-go', 'github.com/confluentinc/confluent-kafka-go/v2', 'github.com/twmb/franz-go'], { uses: 'kafka' }],
  [['github.com/rabbitmq/amqp091-go', 'github.com/streadway/amqp'], { uses: 'rabbitmq' }],
  [['github.com/aws/aws-sdk-go-v2/service/sqs'], { uses: 'sqs' }],
  [['github.com/aws/aws-sdk-go-v2/service/s3'], { uses: 's3' }],
  [['github.com/hibiken/asynq'], { uses: 'jobs' }],
  [['github.com/stripe/stripe-go/v76', 'github.com/stripe/stripe-go/v78', 'github.com/stripe/stripe-go/v79', 'github.com/stripe/stripe-go/v81', 'github.com/stripe/stripe-go/v82'], { uses: 'stripe' }],
  [['github.com/twilio/twilio-go'], { uses: 'twilio' }],
  [['github.com/sendgrid/sendgrid-go'], { uses: 'sendgrid' }],
  [['github.com/sashabaranov/go-openai', 'github.com/openai/openai-go'], { uses: 'openai' }],
];

const DOTNET: Table = [
  [['Grpc.AspNetCore'], { framework: 'aspnet-core' }],
  [['Npgsql', 'Npgsql.EntityFrameworkCore.PostgreSQL'], { uses: 'postgres' }],
  [['MySqlConnector', 'Pomelo.EntityFrameworkCore.MySql', 'MySql.Data'], { uses: 'mysql' }],
  [['MongoDB.Driver'], { uses: 'mongodb' }],
  [['StackExchange.Redis', 'Microsoft.Extensions.Caching.StackExchangeRedis'], { uses: 'redis' }],
  [['Confluent.Kafka'], { uses: 'kafka' }],
  [['RabbitMQ.Client', 'MassTransit.RabbitMQ'], { uses: 'rabbitmq' }],
  [['AWSSDK.SQS'], { uses: 'sqs' }],
  [['AWSSDK.S3'], { uses: 's3' }],
  [['Stripe.net'], { uses: 'stripe' }],
  [['Twilio'], { uses: 'twilio' }],
  [['SendGrid'], { uses: 'sendgrid' }],
  [['OpenAI', 'Azure.AI.OpenAI'], { uses: 'openai' }],
];

export type Ecosystem = 'node' | 'python' | 'java' | 'go' | 'dotnet';

const TABLES: Record<Ecosystem, Map<string, Signal>> = {
  node: index(NODE),
  python: index(PYTHON),
  java: index(JAVA),
  go: index(GO),
  dotnet: index(DOTNET),
};

function index(table: Table): Map<string, Signal> {
  const map = new Map<string, Signal>();
  for (const [names, signal] of table) for (const n of names) map.set(n, signal);
  return map;
}

/** Python names are case-insensitive and treat "_" and "." like "-". */
export const normalizePython = (name: string) => name.toLowerCase().replace(/[_.]+/g, '-');

export function signalFor(ecosystem: Ecosystem, dependency: string): Signal | undefined {
  const table = TABLES[ecosystem];
  if (ecosystem === 'python') return table.get(normalizePython(dependency));
  if (ecosystem === 'node' && dependency.startsWith('@clerk/')) return { uses: 'clerk' };
  if (ecosystem === 'go') {
    const direct = table.get(dependency);
    if (direct) return direct;
    // Major versions live in the path: github.com/stripe/stripe-go/v83.
    if (/^github\.com\/stripe\/stripe-go\/v\d+$/.test(dependency)) return { uses: 'stripe' };
    return undefined;
  }
  return table.get(dependency);
}
