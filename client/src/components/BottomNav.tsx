import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/',            label: 'Home',       icon: null },
  { to: '/goals',       label: 'Goals',      icon: '🎯' },
  { to: '/challenges',  label: 'Challenges', icon: '⚡' },
  { to: '/rankings',    label: 'Rankings',   icon: '🏆' },
  { to: '/achievements',label: 'Achievements',icon: '🏅' },
  { to: '/profile',     label: 'Profile',    icon: '👤' },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      {NAV.map(n => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => 'bn-item' + (isActive ? ' active' : '')}>
          <span className="bn-icon">{n.icon ?? <img className="bn-icon-img" src="/favicon.svg" alt="" />}</span>
          <span className="bn-label">{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
