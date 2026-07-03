import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notificationsApi } from '../api/notifications'

export function useNotifications(unreadOnly: boolean) {
  return useQuery({
    queryKey: ['notifications', { unreadOnly }],
    queryFn: () => notificationsApi.list(unreadOnly),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  })
}

export function useNotificationActions() {
  const qc = useQueryClient()
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: refresh,
  })

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: refresh,
  })

  const clearResolved = useMutation({
    mutationFn: () => notificationsApi.clearResolved(),
    onSuccess: refresh,
  })

  return { markRead, markAllRead, clearResolved }
}
