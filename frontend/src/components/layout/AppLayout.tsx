import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import styles from './AppLayout.module.css';

interface NavItem {
  to: string;
  label: string;
}

// Mismas secciones y orden que la "Barra lateral" del diseño.
const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Configuración',
    items: [
      { to: '/temporadas', label: 'Temporadas y tarifas' },
      { to: '/calendario', label: 'Calendario de temporadas' },
      { to: '/iva', label: 'Porcentaje de IVA' },
    ],
  },
  {
    title: 'Facturación',
    items: [{ to: '/facturas', label: 'Facturas emitidas' }],
  },
];

export function AppLayout() {
  const { session, logout } = useAuth();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <span className={styles.logo} aria-hidden="true">
              H
            </span>
            <div>
              <p className={styles.brandName}>Hospitua</p>
              <p className={styles.brandModule}>Módulo 3 · Facturación</p>
            </div>
          </div>

          <nav aria-label="Secciones">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} className={styles.section}>
                <p className={styles.sectionTitle}>{section.title}</p>
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `${styles.navItem} ${isActive ? styles.active : ''}`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </div>

        <div className={styles.user}>
          <p className={styles.userName}>{session?.username}</p>
          <p className={styles.userRole}>{session?.role}</p>
          <button type="button" className={styles.logout} onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
