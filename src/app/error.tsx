'use client';

// Shown when a page fails on the server, most often because the database did not answer.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--ink)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 12 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Something went wrong</h1>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Most often the database did not answer. Wait a minute and press Try again. If it keeps happening, send a screenshot of this page.</p>
        {error.digest && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Reference: {error.digest}</p>}
        <button className="btn pri" type="button" onClick={() => reset()}>Try again</button>
      </div>
    </div>
  );
}
