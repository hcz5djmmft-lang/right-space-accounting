/** Pill colour per site status: reviewed, passed and verified are done; failed and open need someone; sent and fixed wait for a check. */
export const pillOf = (s: string) => (['reviewed', 'passed', 'verified', 'signed'].includes(s) ? 'posted' : ['failed', 'open'].includes(s) ? 'rejected' : ['submitted', 'fixed'].includes(s) ? 'pending' : '');
