import { NavLink } from 'react-router-dom';

function NavBar() {
  return (
    <nav className="nav-bar">
      <NavLink to="/suburb-finder" className={({ isActive }) => (isActive ? 'active' : undefined)}>
        Suburb Finder
      </NavLink>
      <NavLink to="/rental-price-check" className={({ isActive }) => (isActive ? 'active' : undefined)}>
        Rental Price Check
      </NavLink>
      <NavLink to="/about" className={({ isActive }) => (isActive ? 'active' : undefined)}>
        About
      </NavLink>
    </nav>
  );
}

export default NavBar;
