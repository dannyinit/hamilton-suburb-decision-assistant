import { Link, Outlet } from 'react-router-dom';
import NavBar from './components/NavBar';
import './App.css';

// Layout route: the app header and NavBar are always visible, the active
// feature renders into <Outlet /> below them. See main.jsx for the route
// definitions. The app title is the page's one <h1> — each feature page
// below uses <h2> for its own heading, so the document outline has a
// single top-level heading rather than two competing <h1>s. The title
// text itself is a Link to the default route (/suburb-finder, same
// literal as NavBar's and main.jsx's redirect — no shared route constant
// exists to reuse instead), the standard "click the site name to go
// home" pattern; the <h1> stays the outer element so this doesn't cost
// the single-heading structure above.
function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <Link to="/suburb-finder">Hamilton Suburb Decision Assistant</Link>
        </h1>
      </header>
      <NavBar />
      <Outlet />
    </div>
  );
}

export default App;
