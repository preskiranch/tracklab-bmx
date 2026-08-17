import { randomUUID } from 'node:crypto';

const squareApiVersion = process.env.SQUARE_VERSION || '2026-05-20';
const squareEnvironment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
const squareApiBase = squareEnvironment === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

const bikeSeatMonthlyCents = 999;
const maxBillingBikeSeats = 1000;

function clampBikeSeats(value) {
  return Math.max(1, Math.min(maxBillingBikeSeats, Math.round(Number(value) || 1)));
}

export function racerMonthlyCents(bikeSeats) {
  return clampBikeSeats(bikeSeats) * bikeSeatMonthlyCents;
}

function planVariationId() {
  return process.env.SQUARE_RACER_PLAN_VARIATION_ID
    || process.env.SQUARE_RACER_PLAN_VARIATION_1_BIKE
    || '';
}

export function squareCheckoutConfigStatus() {
  const missing = [];
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    missing.push('SQUARE_ACCESS_TOKEN');
  }
  if (!process.env.SQUARE_LOCATION_ID) {
    missing.push('SQUARE_LOCATION_ID');
  }

  if (!planVariationId()) missing.push('SQUARE_RACER_PLAN_VARIATION_ID');

  return {
    configured: missing.length === 0,
    environment: squareEnvironment,
    currency: 'USD',
    pricing: {
      bikeSeatMonthlyCents,
      maxBillingBikeSeats,
    },
    missing,
  };
}

async function squareFetch(path, options = {}) {
  const response = await fetch(`${squareApiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': squareApiVersion,
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const squareMessage = Array.isArray(payload.errors)
      ? payload.errors.map((error) => error.detail || error.code).filter(Boolean).join('; ')
      : '';
    const error = new Error(squareMessage || `Square request failed with HTTP ${response.status}`);
    error.statusCode = 502;
    error.squareResponse = payload;
    throw error;
  }

  return payload;
}

export async function createRacerSubscriptionCheckout({ bikeSeats, origin, returnState }) {
  const seats = clampBikeSeats(bikeSeats);
  const config = squareCheckoutConfigStatus();
  if (!config.configured) {
    const error = new Error(`Square billing is missing: ${config.missing.join(', ')}`);
    error.statusCode = 503;
    throw error;
  }

  const subscriptionPlanId = planVariationId();
  const monthlyCents = racerMonthlyCents(seats);
  const redirectUrl = new URL(origin || 'http://localhost:10000');
  redirectUrl.searchParams.set('billing', 'success');
  redirectUrl.searchParams.set('tier', 'racer');
  if (returnState) {
    redirectUrl.searchParams.set('billingState', String(returnState).slice(0, 160));
  }

  const payload = await squareFetch('/v2/online-checkout/payment-links', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      quick_pay: {
        name: `TrackLab BMX Racer - ${seats} Wattbike seat${seats === 1 ? '' : 's'}`,
        price_money: {
          amount: monthlyCents,
          currency: 'USD',
        },
        location_id: process.env.SQUARE_LOCATION_ID,
      },
      checkout_options: {
        redirect_url: redirectUrl.toString(),
        subscription_plan_id: subscriptionPlanId,
      },
    }),
  });

  const checkoutUrl = payload?.payment_link?.url;
  const orderId = payload?.payment_link?.order_id;
  const paymentLinkId = payload?.payment_link?.id;
  if (typeof checkoutUrl !== 'string' || !checkoutUrl || typeof orderId !== 'string' || !orderId) {
    const error = new Error('Square did not return a complete checkout link.');
    error.statusCode = 502;
    error.squareResponse = payload;
    throw error;
  }

  return {
    checkoutUrl,
    bikeSeats: seats,
    monthlyCents,
    environment: squareEnvironment,
    orderId,
    paymentLinkId: typeof paymentLinkId === 'string' ? paymentLinkId : '',
  };
}

export async function verifyRacerSubscriptionOrder({ orderId, expectedAmountCents }) {
  const config = squareCheckoutConfigStatus();
  if (!config.configured) {
    const error = new Error(`Square billing is missing: ${config.missing.join(', ')}`);
    error.statusCode = 503;
    throw error;
  }

  const payload = await squareFetch(`/v2/orders/${encodeURIComponent(orderId)}`);
  const order = payload?.order;
  const amount = Number(order?.total_money?.amount);
  const currency = order?.total_money?.currency;
  const valid = order?.id === orderId
    && order?.location_id === process.env.SQUARE_LOCATION_ID
    && order?.state === 'COMPLETED'
    && Number.isFinite(amount)
    && amount === Number(expectedAmountCents)
    && currency === 'USD';

  return {
    valid,
    orderId: typeof order?.id === 'string' ? order.id : '',
    state: typeof order?.state === 'string' ? order.state : 'UNKNOWN',
    amountCents: Number.isFinite(amount) ? amount : null,
    currency: typeof currency === 'string' ? currency : null,
  };
}
