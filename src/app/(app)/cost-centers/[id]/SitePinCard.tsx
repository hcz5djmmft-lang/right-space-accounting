import { hasRole, type User } from '@/lib/roles';
import { canProjects } from '@/lib/projects';
import { UseMyLocation } from '@/components/UseMyLocation';
import { savePinAction } from '../actions';

/** The project page's location pin: where the site is and how far from it a site clock-in may be. Engineers, HR or Finance set it. */
export function SitePinCard({ id, code, lat, lng, radius, user }: { id: string; code: string; lat: number | null; lng: number | null; radius: number; user: User }) {
  const set = lat !== null && lng !== null;
  const can = canProjects(user) || hasRole(user, 'hr');
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Site location</h2>
        {set ? <span className="row"><span className="pill nocap posted">pinned · {radius} m allowed</span><a className="btn sm" href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noopener">Open in Maps</a></span> : <span className="pill nocap pending">no pin yet</span>}</div>
      <p className="muted" style={{ marginTop: 6 }}>Site staff clocking in on {code} must be within the allowed distance of this pin, the way office staff are checked against the office.
        Until it is set, their position is only recorded.{can ? ' Stand on the site and tap “Use my current location”, or type the coordinates from the Maps app (press and hold the pin).' : ''}</p>
      {can && (
        <form action={savePinAction.bind(null, id)}>
          <div className="grid g3">
            <label className="f"><span>Latitude</span><input className="inp mono" name="site_lat" defaultValue={lat ?? ''} inputMode="decimal" placeholder="e.g. 30.0444" /></label>
            <label className="f"><span>Longitude</span><input className="inp mono" name="site_lng" defaultValue={lng ?? ''} inputMode="decimal" placeholder="e.g. 31.2357" /></label>
            <label className="f"><span>Allowed distance (metres)</span><input className="inp mono" name="site_radius_m" defaultValue={radius} inputMode="numeric" /></label>
          </div>
          <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}><UseMyLocation lat="site_lat" lng="site_lng" /><button className="btn pri">Save location</button></div>
        </form>)}
    </div>
  );
}
