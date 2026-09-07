import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`surface rounded-2xl ${className}`}>{children}</div>;
}

export function Button({
  children, onClick, variant = 'primary', disabled, type = 'button', className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const styles = {
    primary: 'bg-[var(--accent)] text-black font-semibold',
    secondary: 'surface',
    ghost: 'bg-transparent',
    danger: 'bg-red-500/15 text-red-500 border border-red-500/30',
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl px-5 py-3.5 transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="muted mb-1.5 block text-xs font-medium tracking-wide uppercase">{label}</span>
      {children}
      {hint ? <span className="muted mt-1 block text-xs">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`surface w-full rounded-xl px-3.5 py-2.5 outline-none focus:border-[var(--accent)] ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`surface w-full rounded-xl px-3.5 py-2.5 outline-none focus:border-[var(--accent)] ${props.className ?? ''}`}
    />
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="muted py-12 text-center text-sm">{label}…</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
      {message}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted py-16 text-center text-sm">{children}</div>;
}
