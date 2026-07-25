import { NavLink, useNavigate } from 'react-router-dom';

const itemClass = ({ isActive }: { isActive: boolean }) => 'bn-item' + (isActive ? ' active' : '');

export function BottomNav() {
  const navigate = useNavigate();

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={itemClass}>
        <span className="bn-icon"><img className="bn-icon-img" src="/favicon.svg" alt="" /></span>
        <span className="bn-label">Feed</span>
      </NavLink>

      {/* Placeholder slot for a future section — inert for now. */}
      <button className="bn-item bn-placeholder" disabled aria-hidden="true" tabIndex={-1}>
        <span className="bn-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
          </svg>
        </span>
        <span className="bn-label">Soon</span>
      </button>

      <div className="bn-add-wrap">
        <button className="bn-add-btn" onClick={() => navigate('/log')} aria-label="Log coffee">
          +
        </button>
      </div>

      <NavLink to="/stats" className={itemClass}>
        <span className="bn-icon">📊</span>
        <span className="bn-label">Stats</span>
      </NavLink>

      <NavLink to="/profile" className={itemClass}>
        <span className="bn-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        </span>
        <span className="bn-label">Profile</span>
      </NavLink>
    </nav>
  );
}
