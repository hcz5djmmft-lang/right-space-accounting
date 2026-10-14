-- Update 18 (Adel, 2026-10-14).
-- Tasks move by themselves: a task can belong to a project; the assignee's clock-in on that project moves it to In progress,
-- "Submit for review" puts it in Review with an approval for whoever gave it, approved = Done, sent back = In progress.
-- Petty cash vouchers are cash payments out of the office safe only (kind petty_cash). Banks & cash hides the accountant's
-- box (A115 stays in the chart). Customers carry a national ID (the old tax_id column, relabelled). Vendors and subcontractors
-- are paid to a bank account or InstaPay and carry a vendor type from an editable list.

alter table tasks add column project_id  text references projects(id) on delete set null;
alter table tasks add column submitted_at timestamptz;
alter table tasks add column submit_note text not null default '';
alter table tasks add column reviewer_id text references users(id);
create index on tasks (project_id, status);

-- the project of the tasks already raised by the system, from the document they point at
update tasks set project_id = link_id where link_type in ('cost-center', 'planning', 'handover', 'snags') and project_id is null and exists (select 1 from projects p where p.id = link_id);
update tasks t set project_id = x.project_id from inspection_requests x where t.link_type = 'inspection' and x.id = t.link_id and t.project_id is null;
update tasks t set project_id = x.project_id from site_reports x where t.link_type = 'site-report' and x.id = t.link_id and t.project_id is null;
update tasks t set project_id = x.project_id from drawing_sets x where t.link_type = 'design' and x.id = t.link_id and t.project_id is null;
update tasks t set project_id = x.project_id from estimates x where t.link_type = 'estimate' and x.id = t.link_id and t.project_id is null;
update tasks t set project_id = x.project_id from purchase_requests x where t.link_type = 'purchase' and x.id = t.link_id and t.project_id is null;
update tasks t set project_id = x.project_id from work_orders x where t.link_type = 'workorder' and x.id = t.link_id and t.project_id is null;
update tasks t set project_id = x.project_id from sub_claims x where t.link_type = 'claim' and x.id = t.link_id and t.project_id is null;
update tasks t set project_id = x.project_id from client_claims x where t.link_type = 'client-claim' and x.id = t.link_id and t.project_id is null;
update tasks t set project_id = x.project_id from variation_orders x where t.link_type = 'variation' and x.id = t.link_id and t.project_id is null;
update tasks t set project_id = x.project_id from invoices x where t.link_type = 'sales-invoice' and x.id = t.link_id and t.project_id is null;

alter table journal_entries drop constraint if exists journal_entries_kind_check;
alter table journal_entries add constraint journal_entries_kind_check check (kind in
  ('expense','collection','transfer','adjustment','payment_request','sales_invoice','payment','receipt','payroll','reversal','partner','petty_cash'));

alter table bank_accounts add column hidden boolean not null default false;   -- kept in the chart and the books, not shown on Banks & cash
update bank_accounts set hidden = true where account = 'A115';
update bank_accounts set holder = 'Office safe' where account = 'A110' and holder = 'Office';

alter table parties add column is_sub      boolean not null default false;    -- a subcontractor (a vendor in the books)
alter table parties add column pay_method  text check (pay_method in ('bank', 'instapay'));
alter table parties add column instapay_no text;
alter table parties add column instapay_to text check (instapay_to in ('account', 'wallet'));
alter table parties add column vendor_type text;

update settings set cats = cats || jsonb_build_object('vendor_type', '["Plumbing","Electricity","Carpentry","Painting","HVAC","Gypsum","Flooring","Glass and aluminium","Furniture","Materials supplier","Other"]'::jsonb)
  where id = 1 and not (cats ? 'vendor_type');
