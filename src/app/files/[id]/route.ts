import { currentUser } from '@/lib/auth';
import { readAttachment } from '@/lib/attachments';

/** Serves an attached file to a signed-in user. Files are never public. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  const { id } = await params;
  const a = await readAttachment(id);
  if (!a) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(a.body), {
    headers: {
      'Content-Type': a.mime_type,
      'Content-Length': String(a.body.length),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.file_name)}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
