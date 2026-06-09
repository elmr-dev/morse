import type { LucideIcon } from 'lucide-react';

/**
 * Shared page header in the receiver tone used across the site: a mono eyebrow
 * label with an icon, a mono title, and an optional intro line. Keeps Decode,
 * Beat the Bot, and other tool pages visually consistent with the landing/FAQ
 * pages now that the old tab strip is gone.
 */
export default function PageHeader({
  eyebrow,
  icon: Icon,
  title,
  children,
  wideIntro = false,
}: {
  eyebrow: string;
  icon: LucideIcon;
  title: string;
  /** Optional intro paragraph below the title. */
  children?: React.ReactNode;
  /** Let the intro run the full content width instead of the readable cap. */
  wideIntro?: boolean;
}) {
  return (
    <header className="mb-5">
      <div className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
        <Icon className="size-3.5 text-primary" />
        {eyebrow}
      </div>
      <h1 className="mt-1.5 font-mono font-bold tracking-tight text-foreground text-2xl sm:text-3xl">
        {title}
      </h1>
      {children && (
        <p
          className={`mt-2 text-sm text-muted-foreground leading-relaxed ${wideIntro ? '' : 'max-w-xl'}`}
        >
          {children}
        </p>
      )}
    </header>
  );
}
