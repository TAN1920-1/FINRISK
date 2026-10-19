import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/app/ThemeProvider';
import { Dropdown, MenuItem, MenuSection } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match system', icon: Monitor },
];

/**
 * Theme switcher.
 *
 * The three-state preference (rather than a simple toggle) is deliberate: a user
 * who picks "Match system" keeps following the operating system instead of
 * being pinned to whichever theme happened to be active when they clicked.
 */
export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();
  const ActiveIcon = resolved === 'dark' ? Moon : Sun;

  return (
    <Dropdown
      label="Colour theme"
      width="w-48"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`Colour theme: ${preference}`}
          title={`Colour theme: ${preference}`}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded border border-border bg-surface text-muted transition-colors hover:text-foreground',
          )}
        >
          <ActiveIcon className="h-4 w-4" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <MenuSection title="Appearance">
          {OPTIONS.map((option) => (
            <MenuItem
              key={option.value}
              selected={option.value === preference}
              onSelect={() => {
                setPreference(option.value);
                close();
              }}
              icon={option.value === preference ? <Check className="h-3.5 w-3.5" aria-hidden /> : <option.icon className="h-3.5 w-3.5" aria-hidden />}
            >
              {option.label}
            </MenuItem>
          ))}
        </MenuSection>
      )}
    </Dropdown>
  );
}
