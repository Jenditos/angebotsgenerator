import { createActivityLogEntry } from "@/server/services/activity-log-service";
import {
  findStoredOfferRecordByNumber,
  updateStoredOfferRecordReminderReference,
} from "@/server/services/offer-store-service";
import { DocumentType, StoredReminderReference } from "@/types/offer";

type OfferStoreOverrides = Parameters<typeof findStoredOfferRecordByNumber>[1];
type ActivityLogOverrides = Parameters<typeof createActivityLogEntry>[1];

export type ScheduleOfferFollowUpReminderInput = {
  userId?: string;
  documentNumber: string;
  documentType: DocumentType;
  idempotencyKey?: string;
  referenceDate?: Date;
  storeOverrides?: OfferStoreOverrides;
  activityOverrides?: ActivityLogOverrides;
};

const OFFER_FOLLOW_UP_DELAY_DAYS = 3;

function addDays(value: Date, days: number): Date {
  const nextDate = new Date(value);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function buildActivityEventKey(idempotencyKey: string | undefined): string | undefined {
  return idempotencyKey ? `${idempotencyKey}:reminder_scheduled` : undefined;
}

export async function scheduleOfferFollowUpReminder(
  input: ScheduleOfferFollowUpReminderInput,
): Promise<StoredReminderReference | null> {
  const documentNumber = input.documentNumber.trim();
  if (!documentNumber || input.documentType !== "offer") {
    return null;
  }

  const idempotencyKey = input.idempotencyKey?.trim() || undefined;
  if (idempotencyKey) {
    const existingDocument = await findStoredOfferRecordByNumber(
      documentNumber,
      input.storeOverrides,
    );
    const existingReminder = existingDocument?.reminder;
    if (
      existingReminder?.status === "scheduled" &&
      existingReminder.idempotencyKey === idempotencyKey
    ) {
      return existingReminder;
    }
  }

  const referenceDate = input.referenceDate ?? new Date();
  const nowIso = referenceDate.toISOString();
  const reminder: StoredReminderReference = {
    status: "scheduled",
    reason: "offer_follow_up",
    idempotencyKey,
    dueAt: addDays(referenceDate, OFFER_FOLLOW_UP_DELAY_DAYS).toISOString(),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const updatedDocument = await updateStoredOfferRecordReminderReference(
    documentNumber,
    reminder,
    input.storeOverrides,
  );
  if (!updatedDocument) {
    return null;
  }

  try {
    await createActivityLogEntry(
      {
        userId: input.userId,
        entityType: "document",
        entityId: documentNumber,
        action: "reminder_scheduled",
        eventKey: buildActivityEventKey(idempotencyKey),
        metadata: {
          documentType: input.documentType,
          dueAt: reminder.dueAt,
          reason: reminder.reason,
        },
        createdAt: referenceDate,
      },
      input.activityOverrides,
    );
  } catch (error) {
    console.warn("[document-reminder] activity could not be written", {
      documentNumber,
      error,
    });
  }

  return reminder;
}
