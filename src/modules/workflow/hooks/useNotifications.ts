import { useState, useEffect, useCallback } from 'react';
import { fetchNotifications, fetchUnreadCount, markNotificationRead, markAllNotificationsRead, subscribeToNotifications } from '../../../services/workflowService';
import type { Notification } from '../../../shared/types';

export function useNotifications(userId: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [notifs, count] = await Promise.all([
        fetchNotifications(userId, 20),
        fetchUnreadCount(userId),
      ]);
      setNotifications(notifs);
      setUnreadCount(count);
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = subscribeToNotifications(userId, (n) => {
      setNotifications(prev => [n, ...prev].slice(0, 20));
      setUnreadCount(prev => prev + 1);
    });
    return unsub;
  }, [userId]);

  const markRead = async (id: string) => {
    await markNotificationRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    await markAllNotificationsRead(userId);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  return { notifications, unreadCount, isLoading, markRead, markAllRead };
}
