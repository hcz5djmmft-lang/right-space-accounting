import { clientFile, projectForToken } from '@/lib/client-link';

/** A drawing file of a design concept sent to the client, opened from their client link. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const project = await projectForToken(token);
  if (!project) return new Response('This link is no longer valid.', { status: 404 });
  const a = await clientFile(project, id);
  if (!a) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(a.body), {
    headers: {
      'Content-Type': a.mime_type,
      'Content-Length': String(a.body.length),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.file_name)}`,
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
