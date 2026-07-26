import { NavLink, useNavigate } from 'react-router-dom';
import { FaTrophy, FaUser, FaLayerGroup } from 'react-icons/fa';
import { AppLogo } from './AppLogo';

const itemClass = ({ isActive }: { isActive: boolean }) => 'bn-item' + (isActive ? ' active' : '');
const ICON = 22; // one size for every nav icon

export function BottomNav() {
  const navigate = useNavigate();

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={itemClass}>
        {/* Feed keeps the app logo rather than a glyph — monochrome, so it
            takes the same muted/active colour as the neighbouring glyphs. */}
        <span className="bn-icon"><AppLogo monochrome="currentColor" /></span>
        <span className="bn-label">Feed</span>
      </NavLink>

      {/* Saved moved under Profile — this slot is the user's own posts. */}
      <NavLink to="/mine" className={itemClass}>
        <span className="bn-icon"><FaLayerGroup size={ICON} /></span>
        <span className="bn-label">Yours</span>
      </NavLink>

      <div className="bn-add-wrap">
        <button className="bn-add-btn" onClick={() => navigate('/log')} aria-label="Post coffee">
          +
        </button>
      </div>

      {/* Stats gave up this slot to Compete and now lives under Profile, the
          same way Saved posts does. */}
      <NavLink to="/compete" className={itemClass}>
        <span className="bn-icon"><FaTrophy size={ICON} /></span>
        <span className="bn-label">Compete</span>
      </NavLink>

      <NavLink to="/profile" className={itemClass}>
        <span className="bn-icon"><FaUser size={ICON} /></span>
        <span className="bn-label">Profile</span>
      </NavLink>
    </nav>
  );
}
