// Client link (improvement 2) against the test database: one live secret per project, the client's page data, answers to
// variation orders and design concepts, the handover signature, and revoking.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

vi.mock('web-push', () => ({ default: { generateVAPIDKeys: () => ({ publicKey: 'P', privateKey: 'Q' }), sendNotification: async () => {} } }));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const cl = await import('@/lib/claims');
const link = await import('@/lib/client-link');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const project = 'cs-ch2505';
type U = { id: string; email: string; name: string; roles: string[] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Youssef', roles: ['engineering'] };
const hr: U = { id: '', email: 'hr@x.test', name: 'Nour HR', roles: ['hr'] };
const SIG = 'data:image/png;base64,' + 'A'.repeat(600);
let token = '', vo = '', set = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, variation_orders, boqs, drawing_sets, handovers, client_links cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [eng, hr]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update projects set contract = 100000 where id = ${project}`;
  vo = await cl.saveVariation(eng as never, { project, title: 'Extra shelves', date: '2026-10-14', lines: [{ description: 'Shelves', unit: 'lot', qty: 2, rate: 1500, account: '28004-2' }] });
  await cl.sendVariation(eng as never, vo);
  [{ id: set }] = await sql<{ id: string }[]>`insert into drawing_sets (project_id, kind, status, designer_id) values (${project}, 'concept_3d', 'client', ${eng.id}) returning id`;
  await sql`insert into handovers (project_id, no, date, client_rep, created_by) values (${project}, 'HO-00001', '2026-10-14', '', ${eng.id})`;
});
afterAll(async () => { await sql.end(); });

describe('client link', () => {
  it('only Finance or the engineers make it; one live link per project', async () => {
    await expect(link.makeLink(hr as never, project)).rejects.toThrow(/Only Finance or the engineers/);
    const first = await link.makeLink(eng as never, project);
    const url = await link.makeLink(eng as never, project);
    expect(url).not.toBe(first);
    token = url.split('/c/')[1];
    expect(await link.projectForToken(first.split('/c/')[1])).toBeNull();
    expect(await link.projectForToken(token)).toBe(project);
    expect(await link.projectForToken('short')).toBeNull();
    expect((await link.linkFor(project))?.url).toBe(url);
  });
  it('the page shows what waits for the client', async () => {
    const v = await link.clientView(project);
    expect(v.project).toMatchObject({ code: 'CS-CH2505', contract: 100000 });
    expect(v.vos).toMatchObject([{ id: vo, status: 'sent', total: 3000 }]);
    expect(v.voLines[vo]).toHaveLength(1);
    expect(v.concepts).toMatchObject([{ id: set, status: 'client', kind_label: expect.stringMatching(/3D/) }]);
    expect(v.handover).toMatchObject({ no: 'HO-00001', client_signed_at: null });
  });
  it('the client approves the variation order: it joins the BOQ and the contract', async () => {
    await expect(link.clientAnswersVariation(token, vo, false, '', 'Mr Hassan')).rejects.toThrow(/Write why/);
    await link.clientAnswersVariation(token, vo, true, '', 'Mr Hassan');
    expect(await cl.getVariation(vo)).toMatchObject({ status: 'approved', decided_by_name: null, notes: expect.stringMatching(/Approved by the client on the client link \(Mr Hassan\)/) });
    expect((await sql`select contract::float c from projects where id = ${project}`)[0].c).toBe(103000);
    await expect(link.clientAnswersVariation(token, vo, true, '', '')).rejects.toThrow(/not waiting for your answer/);
  });
  it('the client asks for changes on the concept: it goes back to the designer as the next version', async () => {
    await expect(link.clientAnswersConcept(token, set, false, ' ', '')).rejects.toThrow(/changes you would like/);
    await link.clientAnswersConcept(token, set, false, 'Warmer wood', 'Mr Hassan');
    expect((await sql`select status, version, client_note from drawing_sets where id = ${set}`)[0]).toMatchObject({ status: 'draft', version: 2, client_note: 'Warmer wood (on the client link by Mr Hassan)' });
  });
  it('the client signs the handover with a drawing, once', async () => {
    await expect(link.clientSignsHandover(token, 'Mr Hassan', 'data:image/png;base64,AAA')).rejects.toThrow(/Sign in the box/);
    await expect(link.clientSignsHandover(token, '', SIG)).rejects.toThrow(/Write your name/);
    await link.clientSignsHandover(token, 'Mr Hassan', SIG);
    expect((await sql`select client_signed_name, client_rep, client_signature from handovers where project_id = ${project}`)[0]).toEqual({ client_signed_name: 'Mr Hassan', client_rep: 'Mr Hassan', client_signature: SIG });
    await expect(link.clientSignsHandover(token, 'Mr Hassan', SIG)).rejects.toThrow(/already signed/);
  });
  it('a revoked link stops at once', async () => {
    await link.revokeLink(eng as never, project);
    expect(await link.projectForToken(token)).toBeNull();
    await expect(link.clientSignsHandover(token, 'x', SIG)).rejects.toThrow(/no longer valid/);
    expect(await link.linkFor(project)).toBeNull();
  });
});
