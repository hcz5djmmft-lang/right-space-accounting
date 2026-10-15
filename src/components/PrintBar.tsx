'use client';

/**
 * The buttons on top of a print page: Print / save as PDF, and Close (update 20). In the installed app a print page opens
 * as its own window with no tab to close, so Close goes back to where the person was, or closes the window when it can.
 */
export function PrintBar() {
  const close = () => {
    if (window.history.length > 1) return window.history.back();
    window.close();
    // a window the browser will not let a page close: go back to the page that opened it, else Overview
    setTimeout(() => { window.location.href = document.referrer && new URL(document.referrer).origin === window.location.origin ? document.referrer : '/'; }, 200);
  };
  return (
    <p className="noprint" style={{ display: 'flex', gap: 8 }}>
      <button type="button" className="btn pri" onClick={() => window.print()}>Print / save as PDF</button>
      <button type="button" className="btn" onClick={close}>✕ Close</button>
    </p>
  );
}
