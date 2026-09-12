import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe } from './lib/hooks';
import { Spinner } from './components/ui';
import { Login } from './routes/Login';
import { Home } from './routes/Home';
import { SpendCheck } from './routes/SpendCheck';
import { History } from './routes/History';
import { Analytics } from './routes/Analytics';
import { Admin } from './routes/Admin';
import { Settings } from './routes/Settings';

export function App() {
  const me = useMe();

  if (me.isLoading) return <Spinner label="Opening Budjo" />;
  if (me.isError || !me.data) return <Login />;

  const isAdmin = me.data.user.role === 'admin';

  return (
    <div className="flex min-h-full flex-col">
      <TopNav isAdmin={isAdmin} />
      <Main isAdmin={isAdmin} />
      <TabBar isAdmin={isAdmin} />
    </div>
  );
}

function useTabs(isAdmin: boolean) {
  return [
    { to: '/', label: 'Home', icon: '◎' },
    { to: '/history', label: 'History', icon: '≡' },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: '⚙' }] : []),
    { to: '/settings', label: 'You', icon: '☺' },
  ];
}

function Main({ isAdmin }: { isAdmin: boolean }) {
  const { pathname } = useLocation();

  // Home and the spend flow are phone-shaped by nature — a single balance and
  // two buttons stretched across a monitor reads worse, not better. History and
  // Admin are the pages with rows and forms that genuinely want the width.
  const wide = pathname.startsWith('/history')
    || pathname.startsWith('/analytics')
    || pathname.startsWith('/admin');

  return (
    <div
      className={`mx-auto w-full flex-1 px-4 pb-28 pt-5 md:pb-12 ${
        wide ? 'max-w-5xl' : 'max-w-lg'
      }`}
    >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/check" element={<SpendCheck />} />
          {/* Pending checks now live on the home screen. */}
          <Route path="/pending" element={<Navigate to="/" replace />} />
          <Route path="/history" element={<History />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={isAdmin ? <Admin /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
  );
}

/**
 * On a large screen the navigation moves to the top: a bar pinned to the bottom
 * of a monitor is a long way from where you are looking, and the thumb-reach
 * argument that puts it there on a phone does not apply.
 */
function TopNav({ isAdmin }: { isAdmin: boolean }) {
  return (
    <header className="surface sticky top-0 z-40 hidden border-x-0 border-t-0 md:block">
      <nav className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-2.5">
        <span className="mr-4 text-sm font-semibold tracking-tight">Budjo</span>
        {useTabs(isAdmin).map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm transition ${
                isActive ? 'bg-[var(--accent)] font-medium text-black' : 'muted hover:opacity-80'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

function TabBar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <nav
      className="surface fixed inset-x-0 bottom-0 mx-auto flex max-w-lg justify-around rounded-t-2xl px-2 pt-2 md:hidden"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {useTabs(isAdmin).map((tab) => (
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
