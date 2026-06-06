import { ReactNode } from 'react';

interface SectionProps {
  title: string;
  description?: string;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  children: ReactNode;
}

export function Section({ title, description, enabled, onToggle, children }: SectionProps) {
  const toggleable = onToggle !== undefined;

  return (
    <section className={`panel ${toggleable && !enabled ? 'panel-off' : ''}`}>
      <header className="panel-header">
        <div className="panel-title-wrap">
          <h3>{title}</h3>
          {description && <p className="panel-desc">{description}</p>}
        </div>
        {toggleable && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={!!enabled}
              onChange={(e) => onToggle!(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        )}
      </header>
      {(!toggleable || enabled) && <div className="panel-body">{children}</div>}
    </section>
  );
}
