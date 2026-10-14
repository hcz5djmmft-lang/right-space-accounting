-- VAT return and WHT certificates (improvement 10): the monthly VAT return Finance marks as prepared (its figures kept
-- as they were then, so a later change in the month shows), and the company's tax registration number for the certificates.
create table vat_returns (
  period      text primary key check (period ~ '^\d{4}-\d{2}$'),
  output_vat  numeric(18,2) not null,
  input_vat   numeric(18,2) not null,
  net_vat     numeric(18,2) not null,
  prepared_by text references users(id),
  prepared_at timestamptz not null default now()
);
alter table settings add column company_tax_id text not null default '';
