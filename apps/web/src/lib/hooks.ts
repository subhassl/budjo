import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountSummary, Card, Category, DecisionResult, LedgerEntry, MeResponse, Remedy, SpendCheck, User,
} from '@budjo/shared';
import { api, del, idemKey, post } from './api';

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

export interface LedgerFilters {
  accountId?: string;
  periodFrom?: string;
  periodTo?: string;
  from?: string;
  to?: string;
}

export interface LedgerPage { entries: LedgerEntry[]; nextCursor: string | null }

/**
 * Paged so a long history does not have to load at once. The query key carries
 * the filters, so changing one starts a fresh page rather than appending to the
 * previous filter's results.
 */
export const useLedger = (filters: LedgerFilters = {}) =>
  useInfiniteQuery({
    queryKey: ['ledger', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.accountId) params.set('account', filters.accountId);
      if (filters.periodFrom) params.set('periodFrom', filters.periodFrom);
      if (filters.periodTo) params.set('periodTo', filters.periodTo);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return api<LedgerPage>(`/ledger${qs ? `?${qs}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Keep the previous filter's results on screen while the new one loads.
    // Without this every tap on a filter blanks the whole page — unnoticeable
    // on localhost, jarring on a phone over cellular.
    placeholderData: (previous) => previous,
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
      occurredOn?: string; reason?: string; forceCorrection?: boolean;
    }) => post<{ ok: true; mode: 'direct' | 'correction' }>(`/admin/ledger/${id}/edit`, body),
    onSuccess: refresh,
  });
}

export function useDeleteLedgerEntry() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (id: string) => del(`/admin/ledger/${id}`),
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
