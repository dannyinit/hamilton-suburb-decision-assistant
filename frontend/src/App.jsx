import { useEffect, useState } from 'react';
import './App.css';

// Step 1 sanity check: confirms the dev server, the /api proxy (see
// vite.config.js), and the backend are all actually wired together before
// any real UI gets built on top. Will be replaced by the Rental Price
// Check form in the next step.
function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
        return res.json();
      })
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="app">
      <h1>Hamilton Suburb Decision Assistant</h1>

      {error && (
        <div className="status-card error">
          <strong>Backend not reachable.</strong>
          <p>{error}</p>
          <p>Is the backend running on port 3001? (<code>npm start</code> in <code>backend/</code>)</p>
        </div>
      )}

      {!error && !health && (
        <div className="status-card">Checking backend connection…</div>
      )}

      {health && (
        <div className="status-card ok">
          <strong>Backend connected.</strong>
          <pre>{JSON.stringify(health, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default App;
