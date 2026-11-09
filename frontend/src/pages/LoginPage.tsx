import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import styles from './LoginPage.module.css';

// No está en el diseño de Figma: es la entrada mínima para obtener el JWT de
// POST /auth/login, con los mismos tokens visuales que el resto de pantallas.
export function LoginPage() {
  const { session, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/iva';
  if (session) return <Navigate to={from} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? 'Usuario o contraseña incorrectos.'
          : cause instanceof Error
            ? cause.message
            : 'No se pudo iniciar sesión.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            H
          </span>
          <div>
            <p className={styles.brandName}>Hospitua</p>
            <p className={styles.brandModule}>Módulo 3 · Facturación</p>
          </div>
        </div>

        <h1 className={styles.title}>Iniciar sesión</h1>

        <label className={styles.field}>
          <span className={styles.label}>Usuario</span>
          <input
            className={styles.input}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Contraseña</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <Notice variant="danger" title="No se pudo iniciar sesión" description={error} />}

        <Button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? 'Ingresando…' : 'Ingresar'}
        </Button>
      </form>
    </div>
  );
}
