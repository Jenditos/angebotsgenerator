import { NextResponse } from "next/server";
import Stripe from "stripe";
import { isAuthBypassEnabled } from "@/lib/access/auth-bypass";
import {
  classifyUserAccessError,
  logUserAccessError,
} from "@/lib/access/access-errors";
import {
  MONTHLY_PRICE_CENTS,
  STRIPE_MONTHLY_PRICE_ID,
  STRIPE_SECRET_KEY,
  resolveAppBaseUrl,
} from "@/lib/stripe/config";
import {
  MONTHLY_PLAN_ID,
  ensureUserAccessRecord,
} from "@/lib/access/user-access";
import { requireAuthenticatedUser } from "@/lib/access/guards";

function createStripeClient(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY);
}

export async function POST(request: Request) {
  if (isAuthBypassEnabled()) {
    return NextResponse.json(
      {
        error:
          "Checkout ist im temporären Login-Bypass deaktiviert. Für Checkout bitte Auth wieder aktivieren.",
      },
      { status: 503 },
    );
  }

  if (!STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe ist noch nicht konfiguriert." },
      { status: 500 },
    );
  }

  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const stripe = createStripeClient();
    const accessRecord = await ensureUserAccessRecord(
      authResult.supabase,
      authResult.user,
    );

    const email = authResult.user.email?.trim() ?? accessRecord.email;
    if (!email) {
      return NextResponse.json(
        { error: "Für Checkout ist eine E-Mail erforderlich." },
        { status: 400 },
      );
    }

    let customerId = accessRecord.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: {
          user_id: authResult.user.id,
        },
      });
      customerId = customer.id;

      const { error: userAccessUpdateError } = await authResult.supabase
        .from("user_access")
        .update({
          stripe_customer_id: customerId,
        })
        .eq("user_id", authResult.user.id);
      if (userAccessUpdateError) {
        throw userAccessUpdateError;
      }
    }

    const baseUrl = resolveAppBaseUrl(request);
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem =
      STRIPE_MONTHLY_PRICE_ID
      ? {
          price: STRIPE_MONTHLY_PRICE_ID,
          quantity: 1,
        }
      : {
          price_data: {
            currency: "eur",
            recurring: {
              interval: "month",
            },
            unit_amount: MONTHLY_PRICE_CENTS,
            product_data: {
              name: "Visioro Monatsabo",
            },
          },
          quantity: 1,
        };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [lineItem],
      success_url: `${baseUrl}/upgrade?checkout=success`,
      cancel_url: `${baseUrl}/upgrade?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: {
        user_id: authResult.user.id,
        plan: MONTHLY_PLAN_ID,
      },
      subscription_data: {
        metadata: {
          user_id: authResult.user.id,
          plan: MONTHLY_PLAN_ID,
        },
      },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Checkout-URL konnte nicht erstellt werden." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      url: session.url,
    });
  } catch (error) {
    logUserAccessError("POST /api/billing/create-checkout-session", error, {
      userId: authResult.user.id,
    });
    const classifiedError = classifyUserAccessError(
      error,
      "Checkout konnte nicht gestartet werden.",
    );
    return NextResponse.json(
      { error: classifiedError.publicMessage },
      { status: classifiedError.status },
    );
  }
}
