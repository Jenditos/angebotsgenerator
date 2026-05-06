import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import {
  ActivityEntityType,
  listActivityLogEntries,
} from "@/server/services/activity-log-service";

const ACTIVITY_ENTITY_TYPES = new Set<ActivityEntityType>([
  "customer",
  "project",
  "document",
  "email",
  "system",
]);

function normalizeEntityType(value: string | null): ActivityEntityType | null {
  return ACTIVITY_ENTITY_TYPES.has(value as ActivityEntityType)
    ? (value as ActivityEntityType)
    : null;
}

function normalizeEntityIds(searchParams: URLSearchParams): Set<string> {
  return new Set(
    searchParams
      .getAll("entityId")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 50),
  );
}

function normalizeLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100;
  }

  return Math.min(Math.floor(parsed), 200);
}

export async function GET(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const url = new URL(request.url);
    const entityType = normalizeEntityType(url.searchParams.get("entityType"));
    const entityIds = normalizeEntityIds(url.searchParams);
    const limit = normalizeLimit(url.searchParams.get("limit"));
    const includeUnscopedActivity = process.env.NODE_ENV !== "production";

    const activities = (await listActivityLogEntries())
      .filter((activity) => {
        if (activity.userId) {
          return activity.userId === accessResult.user.id;
        }

        return includeUnscopedActivity;
      })
      .filter((activity) => !entityType || activity.entityType === entityType)
      .filter(
        (activity) => entityIds.size === 0 || entityIds.has(activity.entityId),
      )
      .slice(0, limit)
      .map((activity) => ({
        id: activity.id,
        entityType: activity.entityType,
        entityId: activity.entityId,
        action: activity.action,
        metadata: activity.metadata,
        createdAt: activity.createdAt,
      }));

    return NextResponse.json({ activities });
  } catch {
    return NextResponse.json(
      { error: "Verlauf konnte nicht geladen werden." },
      { status: 500 },
    );
  }
}
