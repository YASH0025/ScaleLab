import type { Design, Journey } from '@scalelab/model';
import { buildDesign } from './build';

export interface CheckoutShopOptions {
  /** Share of Stripe calls that fail. Default 1%. */
  stripeErrorRate?: number;
  /** Share of Stripe calls that charge the card but don't reply in time. Default 1%. */
  stripeTimeoutRate?: number;
  /** Retries on the Pay step. Default 1, like many payment SDKs. */
  payRetries?: number;
  /** Whether the Pay step sends an idempotency key. Default false. */
  idempotentPay?: boolean;
}

const lognormal = (meanMs: number, p99Ms: number) => ({ kind: 'lognormal' as const, meanMs, p99Ms });

/**
 * ShopSphere checkout: login through Auth0, a catalog with Redis, a cart, and an order
 * service that charges cards through a payment service and Stripe, then saves the order
 * and emits an event for the email worker.
 *
 * The journey teaches two classic payment bugs:
 * - When Stripe times out after charging, the order is never saved: charged, no order.
 * - When the app retries the payment without an idempotency key, some customers are charged twice.
 * Stripe is set to a rough day (1% errors, 1% timeouts) so both show up in one run.
 */
export function checkoutShop(options: CheckoutShopOptions = {}): Design {
  const journey: Journey = {
    id: 'checkout',
    name: 'Checkout',
    steps: [
      { id: 'login', name: 'Log in', serviceNodeId: 'account', operation: 'read', retries: 0, idempotent: false },
      { id: 'browse', name: 'Browse products', serviceNodeId: 'catalog', operation: 'read', retries: 0, idempotent: false },
      { id: 'cart', name: 'Add to cart', serviceNodeId: 'cart', operation: 'write', retries: 0, idempotent: false },
      { id: 'pay', name: 'Pay', serviceNodeId: 'orders', operation: 'write', retries: options.payRetries ?? 1, idempotent: options.idempotentPay ?? false },
      { id: 'confirm', name: 'See confirmation', serviceNodeId: 'orders', operation: 'read', retries: 0, idempotent: false },
    ],
  };
  return buildDesign(
    'ShopSphere checkout',
    'Login, catalog, cart and payments with Auth0, Stripe and Kafka, plus a Checkout journey.',
    [
      { id: 'storefront', tech: 'nextjs', label: 'Storefront', x: 780, y: 0, libraries: ['tailwind-css', 'nextauth'] },
      { id: 'alb', tech: 'aws-alb', label: 'AWS ALB', x: 780, y: 150 },
      { id: 'account', tech: 'express', label: 'Account service', x: 0, y: 310, libraries: ['passport'] },
      { id: 'auth0', tech: 'auth0', label: 'Auth0', x: 0, y: 490 },
      { id: 'catalog', tech: 'spring-boot', label: 'Catalog service', x: 390, y: 310, libraries: ['spring-data-jpa', 'lettuce'] },
      { id: 'redis', tech: 'redis', label: 'Redis', x: 260, y: 490 },
      { id: 'catalog-db', tech: 'postgresql', label: 'Catalog DB', x: 520, y: 490, config: { connectionPool: 25 } },
      { id: 'cart', tech: 'go-gin', label: 'Cart service', x: 780, y: 310 },
      { id: 'cart-db', tech: 'postgresql', label: 'Cart DB', x: 780, y: 490, config: { connectionPool: 25 } },
      { id: 'orders', tech: 'nestjs', label: 'Order service', x: 1170, y: 310, libraries: ['prisma', 'kafkajs'] },
      { id: 'payments', tech: 'spring-boot', label: 'Payment service', x: 1040, y: 490, libraries: ['resilience4j'] },
      {
        id: 'stripe',
        tech: 'stripe',
        label: 'Stripe',
        x: 1040,
        y: 660,
        config: {
          latency: lognormal(350, 1500),
          errorRate: options.stripeErrorRate ?? 0.01,
          timeoutRate: options.stripeTimeoutRate ?? 0.01,
          timeoutMs: 3000,
          rateLimitRps: 100,
        },
      },
      { id: 'orders-db', tech: 'postgresql', label: 'Orders DB', x: 1300, y: 490, config: { connectionPool: 25 } },
      { id: 'kafka', tech: 'kafka', label: 'Order events', x: 1560, y: 490 },
      { id: 'email', tech: 'background-worker', label: 'Email worker', x: 1560, y: 660 },
      { id: 'sendgrid', tech: 'sendgrid', label: 'SendGrid', x: 1560, y: 830 },
    ],
    [
      ['storefront', 'alb'],
      ['alb', 'account'],
      ['alb', 'catalog'],
      ['alb', 'cart'],
      ['alb', 'orders'],
      ['account', 'auth0'],
      ['catalog', 'redis'],
      ['catalog', 'catalog-db'],
      ['cart', 'cart-db'],
      ['orders', 'payments'],
      ['payments', 'stripe'],
      ['orders', 'orders-db'],
      ['orders', 'kafka'],
      ['kafka', 'email'],
      ['email', 'sendgrid'],
    ],
    { journeys: [journey], usersPerSec: 20 },
  );
}
