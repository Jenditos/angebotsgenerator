import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
  : null;

export async function POST(request: Request) {
  try {
    if (!stripe || !process.env.STRIPE_PRICE_ID) {
      return NextResponse.json({ error: "Stripe ist nicht korrekt konfiguriert." }, { status: 500 });
    }
    const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: origin + "?checkout=success",
      cancel_url: origin + "?checkout=cancel"
    });
    if (!session.url) return NextResponse.json({ error: "Keine Stripe-URL." }, { status: 500 });
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (error) {
    console.error("Stripe-Fehler:", error);
    return NextResponse.json({ error: "Fehler bei Stripe-Checkout." }, { status: 500 });
  }
}