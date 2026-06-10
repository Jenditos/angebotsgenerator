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
import {
  PROJECT_TEXT_INPUT_RULES,
  readJsonObject,
  UserInputValidationError,
  validateTextInputs,
} from "@/lib/user-input";

function isProjectStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUS_VALUES.includes(value as ProjectStatus);
}

export async function GET() {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const projects = await listStoredProjects(accessResult.user.id);
    return NextResponse.json({ projects });
  } catch {
    return NextResponse.json(
      { error: "Gespeicherte Baustellen konnten nicht geladen werden." },
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
    const body = await readJsonObject(request);
    const validation = validateTextInputs(body, PROJECT_TEXT_INPUT_RULES);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const {
      projectNumber,
      customerNumber,
      companyName,
      firstName,
      lastName,
      street,
      postalCode,
      city,
      customerName,
      customerAddress,
      customerEmail,
      projectName,
      projectAddress,
      projectNote,
    } = validation.values;

    if (!projectName) {
      return NextResponse.json(
        { error: "Bitte einen Namen für die Baustelle angeben." },
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
      userId: accessResult.user.id,
      projectNumber: projectNumber || undefined,
      customerNumber: customerNumber || undefined,
      customerType: body.customerType === "person" ? "person" : "company",
      companyName,
      salutation: body.salutation === "frau" ? "frau" : "herr",
      firstName,
      lastName,
      street,
      postalCode,
      city,
      customerName,
      customerAddress,
      customerEmail,
      projectName,
      projectAddress,
      status: isProjectStatus(body.projectStatus) ? body.projectStatus : "new",
      note: projectNote,
      draftState: body.draftState,
    });

    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof UserInputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Baustelle konnte nicht gespeichert werden." },
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
        { error: "Baustellennummer fehlt." },
        { status: 400 },
      );
    }

    const removed = await removeStoredProject(
      accessResult.user.id,
      projectNumber,
    );
    if (!removed) {
      return NextResponse.json(
        { error: "Baustelle konnte nicht gelöscht werden." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Gespeicherte Baustelle konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
