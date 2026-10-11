import { requireUser } from '@/lib/auth';
import { listDepartments, listProjects } from '@/lib/queries';
import { listMaterials } from '@/lib/purchasing';
import { PurchaseForm } from '@/components/PurchaseForm';
import { savePurchaseAction } from '../actions';
import { today } from '@/lib/dates';

export default async function NewPurchase() {
  await requireUser();
  const [materials, projects, departments] = await Promise.all([listMaterials(), listProjects(), listDepartments()]);
  return (
    <>
      <div className="head"><div><h1>New purchase request</h1><p>Pick the project or department and the materials with quantities. Procurement prices it and picks the vendor, then the department head and Management approve, and it becomes a purchase order.</p></div></div>
      <PurchaseForm materials={materials} projects={projects} departments={departments} save={savePurchaseAction}
        initial={{ date: today(), neededBy: '', assign: '', notes: '', lines: [{ material: '', qty: '1', description: '' }] }} />
    </>
  );
}
