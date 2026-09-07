import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountSummary, Card, Category, DecisionResult, LedgerEntry, MeResponse, Remedy, SpendCheck, User,
} from '@budjo/shared';
import { api, idemKey, post } from './api';

export interface AccountsResponse { accounts: AccountSummary[] }
export interface ReferenceResponse {
  categories: Category[];
  cards: Card[];
  cardRules: Record<string, string>;
}
export interface CheckResult { check: SpendCheck; result: DecisionResult; remedies: Remedy[] }

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/me'), retry: false });

export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api<AccountsResponse>('/accounts') });

export const useReference = () =>
  useQuery({
    queryKey: ['reference'],
    queryFn: () => api<ReferenceResponse>('/reference'),
    staleTime: 5 * 60_000,
  });

export const usePendingChecks = () =>
  useQuery({
    queryKey: ['checks', 'pending'],
    queryFn: () => api<{ checks: SpendCheck[] }>('/spend-checks?status=pending'),
  });

export const useRecentChecks = () =>
  useQuery({
    queryKey: ['checks', 'all'],
    queryFn: () => api<{ checks: SpendCheck[] }>('/spend-checks?status=all'),
  });

export const useLedger = (accountId?: string) =>
  useQuery({
    queryKey: ['ledger', accountId ?? 'all'],
    queryFn: () =>
      api<{ entries: LedgerEntry[]; nextCursor: string | null }>(
        `/ledger${accountId ? `?account=${encodeURIComponent(accountId)}` : ''}`,
      ),
  });

/** Anything that moves money invalidates balances, holds and history together. */
export function useRefreshMoney() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['accounts'] });
    void qc.invalidateQueries({ queryKey: ['checks'] });
    void qc.invalidateQueries({ queryKey: ['ledger'] });
  };
}

export function useCreateCheck() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (input: {
      accountId: string; estimatedCents: number;
      categoryId?: string | null; cardId?: string | null; merchant?: string | null;
    }) => post<CheckResult>('/spend-checks', input, idemKey()),
    onSuccess: refresh,
  });
}

export function useQuickSpend() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (input: {
      accountId: string; estimatedCents: number; actualCents?: number;
      categoryId?: string | null; cardId?: string | null; merchant?: string | null;
      /** 'YYYY-MM-DD'; omit for today. */
      occurredOn?: string;
    }) => post<CheckResult>('/spends', input, idemKey()),
    onSuccess: refresh,
  });
}

export function useSettleCheck() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: ({ id, actualCents, occurredOn }:
      { id: string; actualCents: number; occurredOn?: string }) =>
      post<{ check: SpendCheck }>(
        `/spend-checks/${id}/settle`,
        occurredOn ? { actualCents, occurredOn } : { actualCents },
        idemKey(),
      ),
    onSuccess: refresh,
  });
}

export function useCancelCheck() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (id: string) => post<{ check: SpendCheck }>(`/spend-checks/${id}/cancel`),
    onSuccess: refresh,
  });
}

export function useRepriceCheck() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: ({ id, accountId }: { id: string; accountId: string }) =>
      post<CheckResult>(`/spend-checks/${id}/reprice`, { accountId }),
    onSuccess: refresh,
  });
}

export function useTransfer() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (input: { fromAccountId: string; toAccountId: string; amountCents: number; note?: string }) =>
      post<{ outEntryId: string }>('/transfers', input, idemKey()),
    onSuccess: refresh,
  });
}

export function useAdvance() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (input: { accountId: string; amountCents: number }) =>
      post<{ advanceId: string; repayPeriod: string }>('/advances', input, idemKey()),
    onSuccess: refresh,
  });
}

export interface AdminOverview {
  users: User[];
  accounts: import('@budjo/shared').Account[];
  access: { accountId: string; userId: string }[];
  categories: Category[];
  cards: Card[];
  family: import('@budjo/shared').FamilySettings;
  allocationRules: { accountId: string; amountCents: number; effectiveFrom: string }[];
}

export const useAdminOverview = (enabled: boolean) =>
  useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api<AdminOverview>('/admin/overview'),
    enabled,
  });

export function useEditLedgerEntry() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; amountCents?: number; accountId?: string;
      categoryId?: string | null; cardId?: string | null; note?: string | null;
      occurredOn?: string; reason: string;
    }) => post(`/admin/ledger/${id}/edit`, body),
    onSuccess: refresh,
  });
}

export function useVoidLedgerEntry() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      post('/admin/void', { ledgerEntryId: id, reason }),
    onSuccess: refresh,
  });
}

export function useAdminMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['reference'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
