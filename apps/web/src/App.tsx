import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useMe } from './lib/hooks';
import { Spinner } from './components/ui';
import { Login } from './routes/Login';
import { Home } from './routes/Home';
import { SpendCheck } from './routes/SpendCheck';
import { History } from './routes/History';
import { Admin } from './routes/Admin';
import { Settings } from './routes/Settings';

export function App() {
  const me = useMe();

  if (me.isLoading) return <Spinner label="Opening Budjo" />;
  if (me.isError || !me.data) return <Login />;

  const isAdmin = me.data.user.role === 'admin';

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col">
      <main className="flex-1 px-4 pb-28 pt-5">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/check" element={<SpendCheck />} />
          {/* Pending checks now live on the home screen. */}
          <Route path="/pending" element={<Navigate to="/" replace />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={isAdmin ? <Admin /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TabBar isAdmin={isAdmin} />
    </div>
  );
}

function TabBar({ isAdmin }: { isAdmin: boolean }) {
  const tabs = [
    { to: '/', label: 'Home', icon: '◎' },
    { to: '/history', label: 'History', icon: '≡' },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: '⚙' }] : []),
    { to: '/settings', label: 'You', icon: '☺' },
  ];

  return (
    <nav
      className="surface fixed inset-x-0 bottom-0 mx-auto flex max-w-lg justify-around rounded-t-2xl px-2 pt-2"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] ${
              isActive ? 'text-[var(--accent)]' : 'muted'
            }`
          }
        >
          <span className="text-lg leading-none">{tab.icon}</span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
