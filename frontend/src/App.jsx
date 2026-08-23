import { Outlet } from 'react-router-dom';
import NavBar from './components/NavBar';
import './App.css';

// Layout route: NavBar is always visible, the active feature renders into
// <Outlet /> below it. See main.jsx for the route definitions.
function App() {
  return (
    <div className="app">
      <NavBar />
      <Outlet />
    </div>
  );
}

export default App;
