import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import SuburbFinder from './components/SuburbFinder.jsx'
import RentalPriceCheck from './components/RentalPriceCheck.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          {/* No landing/chooser page — root redirects straight to Suburb
              Finder: it's the more natural entry point for a user's typical
              workflow (deciding where to look before checking a specific
              rent). `replace` so "/" doesn't sit in browser history as an
              extra back stop. */}
          <Route index element={<Navigate to="/suburb-finder" replace />} />
          <Route path="suburb-finder" element={<SuburbFinder />} />
          <Route path="rental-price-check" element={<RentalPriceCheck />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
