import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppShell from './components/AppShell';
import ProfilePage from './components/ProfilePage';
import OrcidCallback from './components/OrcidCallback';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/register" element={<Navigate to="/" replace />} />

          {/* Phase 41a: User profile page */}
          <Route path="/profile/:userId" element={<ProfilePage />} />

          {/* Phase 41a: ORCID OAuth callback */}
          <Route path="/orcid/callback" element={<OrcidCallback />} />

          {/* AppShell handles both authenticated and guest users */}
          <Route
            path="/*"
            element={<AppShell />}
          />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
