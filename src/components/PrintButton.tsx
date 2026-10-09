'use client';

/** Opens the browser's print dialog; "Save as PDF" there gives the PDF. The side menu and filters are hidden when printing. */
export function PrintButton({ label = 'Print / PDF' }: { label?: string }) {
  return <button type="button" className="btn" onClick={() => window.print()}>{label}</button>;
}
