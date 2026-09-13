import { Outlet } from 'react-router-dom';
import NavBar from './components/NavBar';
import './App.css';

// Layout route: the app header and NavBar are always visible, the active
// feature renders into <Outlet /> below them. See main.jsx for the route
// definitions. The app title is the page's one <h1> — each feature page
// below uses <h2> for its own heading, so the document outline has a
// single top-level heading rather than two competing <h1>s.
function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Hamilton Suburb Decision Assistant</h1>
      </header>
      <NavBar />
      <Outlet />
    </div>
  );
}

export default App;
