import { z } from 'zod';

/** Money always arrives as integer cents; reject floats at the boundary. */
export const centsSchema = z
  .number()
  .int('amount must be whole cents')
  .nonnegative('amount must not be negative')
  .max(100_000_000, 'amount is implausibly large');

export const signedCentsSchema = z
  .number()
  .int('amount must be whole cents')
  .min(-100_000_000)
  .max(100_000_000);

export const idSchema = z.string().min(1).max(64);
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM');

export const createSpendCheckSchema = z.object({
  accountId: idSchema,
  estimatedCents: centsSchema.refine((c) => c > 0, 'amount must be more than zero'),
  categoryId: idSchema.nullish(),
  cardId: idSchema.nullish(),
  merchant: z.string().max(120).nullish(),
  note: z.string().max(500).nullish(),
});

export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const settleSpendCheckSchema = z.object({
  actualCents: centsSchema,
  /** Omit for today. Backdating puts the entry in the month it happened. */
  occurredOn: calendarDateSchema.optional(),
});

export const repriceSchema = z.object({ accountId: idSchema });

export const quickSpendSchema = createSpendCheckSchema.extend({
  actualCents: centsSchema.optional(),
  occurredOn: calendarDateSchema.optional(),
});

export const createTransferSchema = z.object({
  fromAccountId: idSchema,
  toAccountId: idSchema,
  amountCents: centsSchema.refine((c) => c > 0, 'amount must be more than zero'),
  note: z.string().max(500).nullish(),
});

export const createAdvanceSchema = z.object({
  accountId: idSchema,
  amountCents: centsSchema.refine((c) => c > 0, 'amount must be more than zero'),
});

export const setAllocationSchema = z.object({
  accountId: idSchema,
  amountCents: centsSchema,
  effectiveFrom: periodSchema,
});

export const createMemberSchema = z.object({
  displayName: z.string().min(1).max(80),
  email: z.string().email().nullish(),
  role: z.enum(['admin', 'member']),
  accountName: z.string().min(1).max(80).optional(),
  monthlyAllocationCents: centsSchema,
  joinJointAccountIds: z.array(idSchema).default([]),
  allowAdvance: z.boolean().default(false),
});

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  email: z.string().email().nullish(),
  role: z.enum(['admin', 'member']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  allowAdvance: z.boolean().optional(),
  maxAdvanceCents: centsSchema.nullish(),
  sortOrder: z.number().int().optional(),
});

export const updateFamilySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  timezone: z.string().min(1).max(64).optional(),
  reserveThresholdCents: centsSchema.optional(),
  holdTtlHours: z.number().int().min(1).max(720).optional(),
  editWindowHours: z.number().int().min(0).max(720).optional(),
});

export const upsertCategorySchema = z.object({
  name: z.string().min(1).max(60),
  icon: z.string().max(16).default('•'),
  sortOrder: z.number().int().default(0),
  countsAgainstBudget: z.boolean().default(true),
});

export const upsertCardSchema = z.object({
  name: z.string().min(1).max(60),
  issuer: z.string().max(60).nullish(),
  last4: z.string().regex(/^\d{4}$/).nullish(),
  rewardNote: z.string().max(120).nullish(),
  statementCloseDay: z.number().int().min(1).max(31).nullish(),
  dueDay: z.number().int().min(1).max(31).nullish(),
});

export const adjustmentSchema = z.object({
  accountId: idSchema,
  amountCents: signedCentsSchema.refine((c) => c !== 0, 'adjustment cannot be zero'),
  note: z.string().min(1, 'a reason is required').max(500),
});

export const editLedgerEntrySchema = z.object({
  /** Signed, matching the entry's type: a spend stays negative. */
  amountCents: signedCentsSchema.optional(),
  accountId: idSchema.optional(),
  categoryId: idSchema.nullish(),
  cardId: idSchema.nullish(),
  note: z.string().max(500).nullish(),
  occurredOn: calendarDateSchema.optional(),
  /**
   * Required for a correction, optional for an in-place fix inside the window.
   * Validated against the mode the server actually applies.
   */
  reason: z.string().max(500).optional(),
  /** Force a correction even inside the window, when the change is substantive. */
  forceCorrection: z.boolean().optional(),
});

export const voidEntrySchema = z.object({
  ledgerEntryId: idSchema,
  reason: z.string().min(1, 'a reason is required').max(500),
});

export const setAccountAccessSchema = z.object({
  accountId: idSchema,
  userIds: z.array(idSchema),
});

export const claimUserSchema = z.object({ userId: idSchema });
export const inviteRedeemSchema = z.object({ code: z.string().min(4).max(64) });
export const createInviteSchema = z.object({ userId: idSchema });
