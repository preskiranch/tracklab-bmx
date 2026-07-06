import { randomUUID } from 'node:crypto';

const squareApiVersion = process.env.SQUARE_VERSION || '2025-10-16';
const squareEnvironment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
const squareApiBase = squareEnvironment === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

const includedBikeMonthlyCents = 999;
const additionalBikeMonthlyCents = 499;
const maxBillingBikeSeats = 4;

const planVariationEnvByBikeCount = {
  1: 'SQUARE_RACER_PLAN_VARIATION_1_BIKE',
  2: 'SQUARE_RACER_PLAN_VARIATION_2_BIKES',
  3: 'SQUARE_RACER_PLAN_VARIATION_3_BIKES',
  4: 'SQUARE_RACER_PLAN_VARIATION_4_BIKES',
};

function clampBikeSeats(value) {
  return Math.max(1, Math.min(maxBillingBikeSeats, Math.round(Number(value) || 1)));
}

export function racerMonthlyCents(bikeSeats) {
  const seats = clampBikeSeats(bikeSeats);
  return includedBikeMonthlyCents + Math.max(0, seats - 1) * additionalBikeMonthlyCents;
}

function planVariationIdForBikeCount(bikeSeats) {
  const envName = planVariationEnvByBikeCount[clampBikeSeats(bikeSeats)];
  return process.env[envName] || '';
}

export function squareCheckoutConfigStatus() {
  const missing = [];
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    missing.push('SQUARE_ACCESS_TOKEN');
  }
  if (!process.env.SQUARE_LOCATION_ID) {
    missing.push('SQUARE_LOCATION_ID');
  }

  Object.values(planVariationEnvByBikeCount).forEach((envName) => {
    if (!process.env[envName]) {
      missing.push(envName);
    }
  });

  return {
    configured: missing.length === 0,
    environment: squareEnvironment,
    currency: 'USD',
    pricing: {
      includedBikeMonthlyCents,
      additionalBikeMonthlyCents,
      maxBillingBikeSeats,
    },
    missing,
  };
}

export async function createRacerSubscriptionCheckout({ bikeSeats, profileKey, origin }) {
  const seats = clampBikeSeats(bikeSeats);
  const config = squareCheckoutConfigStatus();
  if (!config.configured) {
    const error = new Error(`Square billing is missing: ${config.missing.join(', ')}`);
    error.statusCode = 503;
    throw error;
  }

  const subscriptionPlanId = planVariationIdForBikeCount(seats);
  const monthlyCents = racerMonthlyCents(seats);
  const redirectUrl = new URL(origin || 'http://localhost:10000');
  redirectUrl.searchParams.set('billing', 'success');
  redirectUrl.searchParams.set('tier', 'racer');
  redirectUrl.searchParams.set('bikes', String(seats));
  if (profileKey) {
    redirectUrl.searchParams.set('profileKey', String(profileKey).slice(0, 160));
  }

  const response = await fetch(`${squareApiBase}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': squareApiVersion,
    },
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      quick_pay: {
        name: `TrackLab BMX Racer - ${seats} Wattbike${seats === 1 ? '' : 's'}`,
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

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const squareMessage = Array.isArray(payload.errors)
      ? payload.errors.map((error) => error.detail || error.code).filter(Boolean).join('; ')
      : '';
    const error = new Error(squareMessage || `Square checkout failed with HTTP ${response.status}`);
    error.statusCode = 502;
    error.squareResponse = payload;
    throw error;
  }

  const checkoutUrl = payload?.payment_link?.url;
  if (typeof checkoutUrl !== 'string' || !checkoutUrl) {
    const error = new Error('Square did not return a checkout URL.');
    error.statusCode = 502;
    error.squareResponse = payload;
    throw error;
  }

  return {
    checkoutUrl,
    bikeSeats: seats,
    monthlyCents,
    environment: squareEnvironment,
  };
}
