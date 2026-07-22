import {
  createOutboundCommandIdempotencyKey,
  isOutboundCommandStatusTransitionAllowed,
  type OutboundCommand,
  type OutboundCommandAggregate,
  type OutboundCommandStatus,
  type OutboundCommandType,
} from "../domain/outbound-command";

export interface CreatePendingOutboundCommandInput<TPayload> {
  readonly id: string;
  readonly tenantId: string;
  readonly aggregate: OutboundCommandAggregate;
  readonly type: OutboundCommandType;
  readonly effectKey: string;
  readonly payload: TPayload;
  readonly requestedBy: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface LeaseOutboundCommandInput {
  readonly leaseOwner: string;
  readonly leaseUntil: string;
}

export interface RecordOutboundCommandStatusInput {
  readonly status: Exclude<OutboundCommandStatus, "LEASED">;
  readonly nextAttemptAt?: string | null;
  readonly errorCode?: string | null;
}

function requirePositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${fieldName} must be a positive integer`);
  }
}

/** Creates the user intent. Persistence must enforce tenant + idempotencyKey. */
export function createPendingOutboundCommand<TPayload>(
  input: CreatePendingOutboundCommandInput<TPayload>,
): OutboundCommand<TPayload> {
  requirePositiveInteger(
    input.aggregate.expectedVersion,
    "aggregate.expectedVersion",
  );

  return {
    id: input.id,
    tenantId: input.tenantId,
    aggregate: input.aggregate,
    type: input.type,
    payload: input.payload,
    idempotencyKey: createOutboundCommandIdempotencyKey({
      tenantId: input.tenantId,
      aggregateType: input.aggregate.type,
      aggregateId: input.aggregate.id,
      commandType: input.type,
      effectKey: input.effectKey,
    }),
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: null,
    leaseOwner: null,
    leaseUntil: null,
    lastErrorCode: null,
    requestedBy: input.requestedBy,
    correlationId: input.correlationId,
    createdAt: input.createdAt,
  };
}

/**
 * Pure representation of a worker lease. The repository must perform the
 * corresponding compare-and-set atomically (normally with SKIP LOCKED).
 */
export function leaseOutboundCommand<TPayload>(
  command: OutboundCommand<TPayload>,
  input: LeaseOutboundCommandInput,
): OutboundCommand<TPayload> {
  if (command.status !== "PENDING" && command.status !== "RETRY") {
    throw new Error(`Cannot lease a command in ${command.status} status.`);
  }

  return {
    ...command,
    status: "LEASED",
    attemptCount: command.attemptCount + 1,
    nextAttemptAt: null,
    leaseOwner: input.leaseOwner,
    leaseUntil: input.leaseUntil,
  };
}

/** Applies a worker/reconciler result while preserving the original intent. */
export function recordOutboundCommandStatus<TPayload>(
  command: OutboundCommand<TPayload>,
  input: RecordOutboundCommandStatusInput,
): OutboundCommand<TPayload> {
  if (!isOutboundCommandStatusTransitionAllowed(command.status, input.status)) {
    throw new Error(
      `Cannot transition command ${command.status} to ${input.status}.`,
    );
  }

  if (input.status === "RETRY" && !input.nextAttemptAt) {
    throw new Error("RETRY requires nextAttemptAt.");
  }

  return {
    ...command,
    status: input.status,
    nextAttemptAt: input.status === "RETRY" ? input.nextAttemptAt ?? null : null,
    leaseOwner: null,
    leaseUntil: null,
    lastErrorCode: input.errorCode ?? null,
  };
}
