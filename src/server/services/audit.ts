import "server-only";
import type { ClientSession } from "mongoose";
import { isDuplicateKeyError } from "@/lib/errors";
import { redact } from "@/lib/logger";
import {
  AuditLog,
  TimelineEvent,
  type ITimelineEvent,
  type Role,
  type TimelineEventType,
  type TimelineSource,
} from "@/server/models";
import type { Actor } from "@/server/auth/actor";

type ActorLike = Actor | { userId: null; role: "system" };

function safe(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  return redact(obj) as Record<string, unknown>;
}

export async function audit(
  actor: ActorLike,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata?: Record<string, unknown>,
  session?: ClientSession | null,
) {
  await AuditLog.create(
    [
      {
        actorId: actor.userId,
        actorRole: actor.role,
        action,
        resourceType,
        resourceId,
        metadata: safe(metadata),
        at: new Date(),
      },
    ],
    { session: session ?? undefined },
  );
}

export interface TimelineInput {
  tenancyId: string;
  landlordId: string;
  type: TimelineEventType;
  source: TimelineSource;
  actor: ActorLike;
  summary: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  visibility?: ITimelineEvent["visibility"];
  correctsEventId?: string | null;
  /** Makes the event idempotent across retries (e.g. webhook re-delivery). */
  dedupeKey?: string;
}

/** Append an event to the Shared Tenancy Record. Timestamps are always server-generated. */
export async function recordTimeline(input: TimelineInput, session?: ClientSession | null) {
  try {
    await TimelineEvent.create(
      [
        {
          tenancyId: input.tenancyId,
          landlordId: input.landlordId,
          type: input.type,
          source: input.source,
          actorId: input.actor.userId,
          actorRole: input.actor.role as Role | "system",
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          summary: input.summary.slice(0, 500),
          metadata: safe(input.metadata),
          before: safe(input.before),
          after: safe(input.after),
          visibility: input.visibility ?? "shared",
          correctsEventId: input.correctsEventId ?? null,
          occurredAt: new Date(),
          dedupeKey: input.dedupeKey ?? null,
        },
      ],
      { session: session ?? undefined },
    );
  } catch (e) {
    if (input.dedupeKey && isDuplicateKeyError(e)) return; // already recorded
    throw e;
  }
}
