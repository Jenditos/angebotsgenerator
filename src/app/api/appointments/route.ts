import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { createActivityLogEntry } from "@/server/services/activity-log-service";
import {
  listStoredAppointments,
  removeStoredAppointment,
  upsertStoredAppointment,
} from "@/server/services/appointment-store-service";
import {
  APPOINTMENT_STATUS_VALUES,
  APPOINTMENT_TYPE_VALUES,
  AppointmentStatus,
  AppointmentType,
} from "@/types/offer";

type AppointmentPostBody = {
  appointmentNumber?: unknown;
  title?: unknown;
  type?: unknown;
  status?: unknown;
  date?: unknown;
  startTime?: unknown;
  durationMinutes?: unknown;
  customerNumber?: unknown;
  projectNumber?: unknown;
  customerName?: unknown;
  projectName?: unknown;
  address?: unknown;
  note?: unknown;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAppointmentType(value: unknown): value is AppointmentType {
  return APPOINTMENT_TYPE_VALUES.includes(value as AppointmentType);
}

function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return APPOINTMENT_STATUS_VALUES.includes(value as AppointmentStatus);
}

function normalizeDurationMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 60;
  }

  return Math.min(720, Math.max(15, Math.floor(parsed)));
}

function parseLocalAppointmentStart(date: unknown, startTime: unknown): Date | null {
  const dateValue = asTrimmedString(date);
  const timeValue = asTrimmedString(startTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) {
    return null;
  }

  const parsed = new Date(`${dateValue}T${timeValue}:00`);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return parsed;
}

async function recordAppointmentActivitySafely(input: {
  userId: string;
  appointmentNumber: string;
  action: "appointment_created" | "appointment_updated" | "appointment_deleted";
  metadata?: Record<string, unknown>;
}) {
  try {
    await createActivityLogEntry({
      userId: input.userId,
      entityType: "appointment",
      entityId: input.appointmentNumber,
      action: input.action,
      metadata: input.metadata,
    });
  } catch (error) {
    console.warn("[appointments] activity could not be written", {
      appointmentNumber: input.appointmentNumber,
      error,
    });
  }
}

export async function GET() {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const appointments = await listStoredAppointments(accessResult.user.id);
    return NextResponse.json(
      { appointments },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Termine konnten nicht geladen werden." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const body = (await request.json()) as AppointmentPostBody;
    const title = asTrimmedString(body.title);
    const start = parseLocalAppointmentStart(body.date, body.startTime);
    if (!title) {
      return NextResponse.json({ error: "Termintitel fehlt." }, { status: 400 });
    }
    if (!start) {
      return NextResponse.json(
        { error: "Bitte Datum und Startzeit prüfen." },
        { status: 400 },
      );
    }

    const durationMinutes = normalizeDurationMinutes(body.durationMinutes);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const appointmentNumber = asTrimmedString(body.appointmentNumber);
    const appointment = await upsertStoredAppointment({
      userId: accessResult.user.id,
      appointmentNumber: appointmentNumber || undefined,
      title,
      type: isAppointmentType(body.type) ? body.type : "site_visit",
      status: isAppointmentStatus(body.status) ? body.status : "planned",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      customerNumber: asTrimmedString(body.customerNumber) || undefined,
      projectNumber: asTrimmedString(body.projectNumber) || undefined,
      customerName: asTrimmedString(body.customerName),
      projectName: asTrimmedString(body.projectName) || undefined,
      address: asTrimmedString(body.address) || undefined,
      note: asTrimmedString(body.note) || undefined,
    });

    await recordAppointmentActivitySafely({
      userId: accessResult.user.id,
      appointmentNumber: appointment.appointmentNumber,
      action: appointmentNumber ? "appointment_updated" : "appointment_created",
      metadata: {
        title: appointment.title,
        type: appointment.type,
        status: appointment.status,
        startAt: appointment.startAt,
      },
    });

    return NextResponse.json({ appointment });
  } catch {
    return NextResponse.json(
      { error: "Termin konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const url = new URL(request.url);
    const appointmentNumber = (url.searchParams.get("appointmentNumber") ?? "").trim();
    if (!appointmentNumber) {
      return NextResponse.json(
        { error: "Terminnummer fehlt." },
        { status: 400 },
      );
    }

    const removed = await removeStoredAppointment(
      accessResult.user.id,
      appointmentNumber,
    );
    if (!removed) {
      return NextResponse.json(
        { error: "Termin konnte nicht gelöscht werden." },
        { status: 404 },
      );
    }

    await recordAppointmentActivitySafely({
      userId: accessResult.user.id,
      appointmentNumber,
      action: "appointment_deleted",
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Termin konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
