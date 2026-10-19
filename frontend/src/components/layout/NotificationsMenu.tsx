import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/queryClient';
import { cn } from '@/lib/cn';
import { Dropdown, MenuDivider } from '@/components/ui/Menu';
import { Button } from '@/components/ui/Button';
import type { Notification, NotificationLevel, Page } from '@/types/api';

const LEVEL_DOT: Record<NotificationLevel, string> = {
  info: 'bg-primary',
  success: 'bg-risk-low',
  warning: 'bg-risk-medium',
  critical: 'bg-risk-critical',
};

/**
 * Notification inbox in the top bar.
 *
 * The badge counts genuinely unread rows for the signed-in user in the active
 * organization; it is not a decorative counter. "Mark all read" is the same
 * endpoint the audit trail records, so clearing the badge is an auditable act.
 */
export function NotificationsMenu() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const summary = useQuery({
    queryKey: queryKeys.notificationSummary,
    queryFn: () => api.get<{ unread: number }>('/api/notifications/summary'),
    refetchInterval: 60_000,
  });

  const list = useQuery({
    queryKey: queryKeys.notifications({ unread_only: false }),
    queryFn: () =>
      api.get<Page<Notification>>('/api/notifications', {
        query: { page: 1, page_size: 8 },
      }),
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.post<Notification>(`/api/notifications/${id}/read`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    },
  });

  const markAll = useMutation({
    mutationFn: () => api.post<{ message: string }>('/api/notifications/read-all'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unread = summary.data?.unread ?? 0;
  const items = list.data?.items ?? [];

  return (
    <Dropdown
      label="Notifications"
      width="w-96"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded border border-border bg-surface text-muted transition-colors hover:text-foreground"
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
      )}
    >
      {(close) => (
        <div>
          <header className="flex items-center justify-between gap-2 px-3 py-2">
            <p className="text-xs font-semibold text-foreground">Notifications</p>
            <Button
              size="sm"
              variant="ghost"
              disabled={unread === 0 || markAll.isPending}
              loading={markAll.isPending}
              icon={<CheckCheck className="h-3.5 w-3.5" aria-hidden />}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          </header>
          <MenuDivider />
          {list.isLoading ? (
            <p className="px-3 py-4 text-xs text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted">
              No notifications yet. Alerts appear here when a plan falls due or a register change needs
              attention.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {items.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!notification.is_read) markRead.mutate(notification.id);
                      if (notification.link) {
                        close();
                        navigate(notification.link);
                      }
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-muted',
                      notification.is_read && 'opacity-70',
                    )}
                  >
                    <span
                      className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', LEVEL_DOT[notification.level])}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {notification.title}
                      </span>
                      {notification.body ? (
                        <span className="mt-0.5 block line-clamp-2 text-2xs text-muted">
                          {notification.body}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-2xs text-muted">
                        {formatRelative(notification.created_at)}
                      </span>
                    </span>
                    {!notification.is_read ? (
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dropdown>
  );
}
