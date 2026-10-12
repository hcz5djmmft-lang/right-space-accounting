import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listDepartments, listProjects } from '@/lib/queries';
import { getPurchaseLines, getPurchaseRequest, listMaterials } from '@/lib/purchasing';
import { PurchaseForm } from '@/components/PurchaseForm';
import { savePurchaseAction } from '../../actions';

export default async function EditPurchase({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const r = await getPurchaseRequest(id);
  if (!r) notFound();
  if (!['draft', 'rejected'].includes(r.status)) redirect('/purchasing/' + id);
  const [materials, projects, departments, lines] = await Promise.all([listMaterials(), listProjects(), listDepartments(), getPurchaseLines(id)]);
  return (
    <>
      <div className="head"><div><h1>Edit {r.no}</h1><p>Submitting again sends it back to Procurement.</p></div></div>
      <PurchaseForm materials={materials} projects={projects} departments={departments} save={savePurchaseAction}
        initial={{ id, date: r.date, neededBy: r.needed_by ?? '', assign: r.project_id ? 'p:' + r.project_id : 'd:' + r.dept_id, notes: r.notes,
          lines: lines.map(l => ({ material: l.material_id ?? '', qty: String(l.qty), description: l.description })) }} />
    </>
  );
}
