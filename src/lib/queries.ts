import 'server-only';
import { sql } from './db';
import type { AccountType } from './ledger';

export type Acc = { code: string; name: string; type: AccountType; parent: string | null; postable: boolean; is_bank: boolean; is_system: boolean; project_id: string | null; budget: number | null; cost_type: string | null };
export type Proj = { id: string; code: string; name: string; type: string | null; status: string; is_office: boolean };
export type Dept = { id: string; code: string; name: string; active: boolean };
export type Party = { id: string; code: string | null; name: string; type: 'customer' | 'vendor' };

export const listAccounts = () => sql<Acc[]>`select code, name, type, parent, postable, is_bank, is_system, project_id, budget, cost_type from accounts order by code`;
export const listProjects = () => sql<Proj[]>`select id, code, name, type, status, is_office from projects order by is_office desc, code`;
export const listDepartments = () => sql<Dept[]>`select id, code, name, active from departments order by code`;
export const listParties = () => sql<Party[]>`select id, code, name, type from parties order by name`;

export const label = (p: { code?: string | null; name: string }) => (p.code && p.code !== p.name ? `${p.code} · ${p.name}` : p.name);
