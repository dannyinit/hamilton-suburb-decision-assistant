import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import RentalPriceCheck from './components/RentalPriceCheck.jsx'
import SuburbFinder from './components/SuburbFinder.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          {/* No landing/chooser page — root redirects straight to Rental
              Price Check, since it's the more complete feature. `replace`
              so "/" doesn't sit in browser history as an extra back stop. */}
          <Route index element={<Navigate to="/rental-price-check" replace />} />
          <Route path="rental-price-check" element={<RentalPriceCheck />} />
          <Route path="suburb-finder" element={<SuburbFinder />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
