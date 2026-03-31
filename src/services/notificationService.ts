export type { Notification } from '../shared/types';

export {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead as markAsRead,
  markAllNotificationsRead as markAllAsRead,
  subscribeToNotifications,
  createNotification as triggerNotification,
} from './workflowService';
