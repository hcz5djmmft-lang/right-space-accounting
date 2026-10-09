import 'server-only';
import { listAccounts, listDepartments, listParties, listProjects } from './queries';

export async function formLists() {
  const [accounts, projects, departments, parties] = await Promise.all([listAccounts(), listProjects(), listDepartments(), listParties()]);
  return { accounts, projects, departments, vendors: parties.filter(p => p.type === 'vendor') };
}
