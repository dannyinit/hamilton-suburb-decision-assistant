import { NavLink } from 'react-router-dom';

// The tab bar under the app title, linking the three pages. NavLink marks
// the current page's tab as active so it can be styled differently.
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
