import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MONTHLY_PLAN_ID } from "@/lib/access/user-access";
import {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  isStripeWebhookConfigured,
} from "@/lib/stripe/config";

export const runtime = "nodejs";

function createStripeClient(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY);
}

function mapSubscriptionStatus(status: Stripe.Subscription.Status): string {
  if (status === "active" || status === "trialing") {
    return "active";
  }
  if (status === "past_due") {
    return "past_due";
  }
  if (status === "incomplete") {
    return "incomplete";
  }
  if (status === "unpaid") {
    return "unpaid";
  }
  return "canceled";
}

async function updateByUserId(
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from("user_access").update(patch).eq("user_id", userId);
}

async function updateByCustomerId(
  customerId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from("user_access").update(patch).eq("stripe_customer_id", customerId);
}

export async function POST(request: Request) {
  if (!isStripeWebhookConfigured()) {
    return NextResponse.json(
      { error: "Stripe Webhook ist nicht konfiguriert." },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Stripe-Signatur fehlt." },
      { status: 400 },
    );
  }

  const rawBody = await request.text();
  const stripe = createStripeClient();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return NextResponse.json(
      { error: "Webhook-Signatur ungültig." },
      { status: 400 },
    );
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        const customerId =
          typeof session.customer === "string" ? session.customer : null;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : null;
        const userId = session.metadata?.user_id?.trim() ?? "";

        if (userId) {
          await updateByUserId(userId, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_status: "active",
            plan: MONTHLY_PLAN_ID,
          });
        } else if (customerId) {
          await updateByCustomerId(customerId, {
            stripe_subscription_id: subscriptionId,
            subscription_status: "active",
            plan: MONTHLY_PLAN_ID,
          });
        }
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : null;
      if (customerId) {
        await updateByCustomerId(customerId, {
          stripe_subscription_id: subscription.id,
          subscription_status: mapSubscriptionStatus(subscription.status),
          plan:
            subscription.status === "active" ||
            subscription.status === "trialing"
              ? MONTHLY_PLAN_ID
              : "trial",
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json(
      { error: "Webhook konnte nicht verarbeitet werden." },
      { status: 500 },
    );
  }
}
