import type { User } from '@/lib/roles';
import { canLink, linkFor } from '@/lib/client-link';
import { CopyButton } from '@/components/CopyButton';
import { makeLinkAction, revokeLinkAction } from './client-link-actions';

/** The project page's client link card (improvement 2): make, copy, send on WhatsApp, revoke. */
export async function ClientLinkCard({ id, user }: { id: string; user: User }) {
  if (!canLink(user)) return null;
  const link = await linkFor(id);
  const text = link ? `Right Space Development: your project page, with your invoices, progress claims and the items waiting for your approval: ${link.url}` : '';
  return (
    <div className="card" id="client-link">
      <h2 style={{ marginTop: 0 }}>Client link</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>A private link for the client, no login: invoices and what is left to pay, progress claims, variation orders and design concepts to approve, and the handover certificate to sign with a finger. The &quot;Client approved&quot; buttons stay for answers given by phone or on paper.</p>
      {link ? <>
        <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all', marginBottom: 8 }}>{link.url}</div>
        <div className="row">
          <CopyButton text={link.url} />
          <a className="btn sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
          <a className="btn sm" href={link.url} target="_blank" rel="noreferrer">Open as the client</a>
          <form action={revokeLinkAction.bind(null, id)} style={{ display: 'inline' }}><button className="btn sm bad">Revoke link</button></form>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Made {link.created_at}{link.created_by ? ` by ${link.created_by}` : ''} · {link.last_seen_at ? `last opened ${link.last_seen_at}` : 'not opened yet'}. Revoking stops it at once; a new link is a new address.</p>
      </> : <form action={makeLinkAction.bind(null, id)}><button className="btn pri">Make client link</button></form>}
    </div>
  );
}
