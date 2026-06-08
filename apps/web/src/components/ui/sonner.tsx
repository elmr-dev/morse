import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '@/lib/use-theme';

/** Themed Sonner toaster. Toasts mostly surface in standalone mode, where the
 *  fixed bottom tab bar (pb-20) sits, so offset bottom-center toasts above it —
 *  aligning with the PWA update prompt's bottom-24. Colours come from theme
 *  tokens, not Sonner's defaults. */
export function Toaster(props: ToasterProps) {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      offset={{ bottom: '96px' }}
      mobileOffset={{ bottom: '96px' }}
      toastOptions={{
        classNames: {
          toast:
            'group rounded-lg border border-border bg-card text-card-foreground shadow-lg',
          description: 'text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
