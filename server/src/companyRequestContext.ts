import { AsyncLocalStorage } from 'node:async_hooks';

export type CompanyRole = 'admin' | 'collaborator' | 'read_only';
export type RequestCompanyContext = { userId: number; companyId: number | null; role: CompanyRole | null; platformRole: 'user' | 'admin' };
const context = new AsyncLocalStorage<RequestCompanyContext>();

export function runWithCompanyContext<T>(value: RequestCompanyContext, callback: () => T): T {
  return context.run(value, callback);
}

export function currentCompanyContext() { return context.getStore(); }
