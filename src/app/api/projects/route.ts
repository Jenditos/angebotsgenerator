import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import {
  PROJECT_STATUS_VALUES,
  ProjectStatus,
} from "@/types/offer";
import {
  listStoredProjects,
  removeStoredProject,
  upsertStoredProject,
} from "@/server/services/project-store-service";

function isProjectStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUS_VALUES.includes(value as ProjectStatus);
}

export async function GET() {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const projects = await listStoredProjects();
    return NextResponse.json({ projects });
  } catch {
    return NextResponse.json(
      { error: "Gespeicherte Projekte konnten nicht geladen werden." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const body = (await request.json()) as {
      projectNumber?: unknown;
      customerNumber?: unknown;
      customerType?: unknown;
      companyName?: unknown;
      salutation?: unknown;
      firstName?: unknown;
      lastName?: unknown;
      street?: unknown;
      postalCode?: unknown;
      city?: unknown;
      customerName?: unknown;
      customerAddress?: unknown;
      customerEmail?: unknown;
      projectName?: unknown;
      projectAddress?: unknown;
      projectStatus?: unknown;
      projectNote?: unknown;
      draftState?: unknown;
    };

    const projectName =
      typeof body.projectName === "string" ? body.projectName.trim() : "";
    const customerName =
      typeof body.customerName === "string" ? body.customerName.trim() : "";
    const customerAddress =
      typeof body.customerAddress === "string" ? body.customerAddress.trim() : "";

    if (!projectName) {
      return NextResponse.json(
        { error: "Projektname fehlt." },
        { status: 400 },
      );
    }

    if (!customerName) {
      return NextResponse.json(
        { error: "Bitte zuerst einen Kunden oder Ansprechpartner angeben." },
        { status: 400 },
      );
    }

    if (!customerAddress) {
      return NextResponse.json(
        { error: "Bitte zuerst eine Kundenadresse angeben." },
        { status: 400 },
      );
    }

    const project = await upsertStoredProject({
      projectNumber:
        typeof body.projectNumber === "string" ? body.projectNumber.trim() : undefined,
      customerNumber:
        typeof body.customerNumber === "string" ? body.customerNumber.trim() : undefined,
      customerType: body.customerType === "person" ? "person" : "company",
      companyName:
        typeof body.companyName === "string" ? body.companyName.trim() : "",
      salutation: body.salutation === "frau" ? "frau" : "herr",
      firstName:
        typeof body.firstName === "string" ? body.firstName.trim() : "",
      lastName: typeof body.lastName === "string" ? body.lastName.trim() : "",
      street: typeof body.street === "string" ? body.street.trim() : "",
      postalCode:
        typeof body.postalCode === "string" ? body.postalCode.trim() : "",
      city: typeof body.city === "string" ? body.city.trim() : "",
      customerName,
      customerAddress,
      customerEmail:
        typeof body.customerEmail === "string" ? body.customerEmail.trim() : "",
      projectName,
      projectAddress:
        typeof body.projectAddress === "string" ? body.projectAddress.trim() : "",
      status: isProjectStatus(body.projectStatus) ? body.projectStatus : "new",
      note: typeof body.projectNote === "string" ? body.projectNote.trim() : "",
      draftState: body.draftState,
    });

    return NextResponse.json({ project });
  } catch {
    return NextResponse.json(
      { error: "Projekt konnte nicht gespeichert werden." },
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
    const projectNumber = (url.searchParams.get("projectNumber") ?? "").trim();
    if (!projectNumber) {
      return NextResponse.json(
        { error: "Projektnummer fehlt." },
        { status: 400 },
      );
    }

    const removed = await removeStoredProject(projectNumber);
    if (!removed) {
      return NextResponse.json(
        { error: "Projekt konnte nicht gelöscht werden." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Gespeichertes Projekt konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
