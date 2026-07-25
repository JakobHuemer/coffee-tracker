import { NavLink, useNavigate } from 'react-router-dom';
import { FaChartBar, FaUser, FaRegBookmark } from 'react-icons/fa';

const itemClass = ({ isActive }: { isActive: boolean }) => 'bn-item' + (isActive ? ' active' : '');
const ICON = 22; // one size for every nav icon

export function BottomNav() {
  const navigate = useNavigate();

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={itemClass}>
        {/* Feed keeps the app logo rather than a glyph. */}
        <span className="bn-icon"><img className="bn-icon-img" src="/favicon.svg" alt="" /></span>
        <span className="bn-label">Feed</span>
      </NavLink>

      <NavLink to="/saved" className={itemClass}>
        <span className="bn-icon"><FaRegBookmark size={ICON} /></span>
        <span className="bn-label">Saved</span>
      </NavLink>

      <div className="bn-add-wrap">
        <button className="bn-add-btn" onClick={() => navigate('/log')} aria-label="Post coffee">
          +
        </button>
      </div>

      <NavLink to="/stats" className={itemClass}>
        <span className="bn-icon"><FaChartBar size={ICON} /></span>
        <span className="bn-label">Stats</span>
      </NavLink>

      <NavLink to="/profile" className={itemClass}>
        <span className="bn-icon"><FaUser size={ICON} /></span>
        <span className="bn-label">Profile</span>
      </NavLink>
    </nav>
  );
}
