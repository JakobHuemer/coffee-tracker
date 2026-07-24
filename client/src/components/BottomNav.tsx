import { NavLink, useNavigate } from 'react-router-dom';

export function BottomNav() {
  const navigate = useNavigate();

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={({ isActive }) => 'bn-item' + (isActive ? ' active' : '')}>
        <span className="bn-icon"><img className="bn-icon-img" src="/favicon.svg" alt="" /></span>
        <span className="bn-label">Feed</span>
      </NavLink>

      <div className="bn-add-wrap">
        <button className="bn-add-btn" onClick={() => navigate('/log')} aria-label="Log coffee">
          +
        </button>
      </div>

      <NavLink to="/stats" className={({ isActive }) => 'bn-item' + (isActive ? ' active' : '')}>
        <span className="bn-icon">📊</span>
        <span className="bn-label">Stats</span>
      </NavLink>
    </nav>
  );
}
