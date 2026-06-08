import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type Theme, useTheme } from '@/lib/use-theme';

const icons: Record<Theme, React.ReactNode> = {
  light: <Sun className="size-5 sm:size-4" />,
  dark: <Moon className="size-5 sm:size-4" />,
  system: <Monitor className="size-5 sm:size-4" />,
};

export default function ThemeSwitcher() {
  const { theme, cycleTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleTheme}
      aria-label={`Theme: ${theme}`}
      title={`Theme: ${theme}`}
      className="size-11 sm:size-9"
    >
      {icons[theme]}
    </Button>
  );
}
