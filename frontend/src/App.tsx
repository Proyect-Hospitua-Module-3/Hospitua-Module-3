import { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { PendingPage } from './pages/PendingPage';
import { VatRatePage } from './pages/vat-rate/VatRatePage';

// Sin sesión, cualquier pantalla lleva al login y vuelve a ella después de entrar.
function RequireSession({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireSession>
            <AppLayout />
          </RequireSession>
        }
      >
        <Route path="/iva" element={<VatRatePage />} />
        <Route
          path="/temporadas"
          element={<PendingPage title="Temporadas y tarifas" spec="009" />}
        />
        <Route
          path="/calendario"
          element={<PendingPage title="Calendario de temporadas" spec="011" />}
        />
        <Route path="/facturas" element={<PendingPage title="Facturas emitidas" spec="008" />} />
        <Route path="*" element={<Navigate to="/iva" replace />} />
      </Route>
    </Routes>
  );
}
