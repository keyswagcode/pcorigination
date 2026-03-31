import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Check, CheckCheck, AlertTriangle, FileText, UserPlus, Shield, Info } from 'lucide-react';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAsRead,
  markAllAsRead,
  subscribeToNotifications,
} from '../../services/notificationService';
import type { Notification } from '../../services/notificationService';

interface NotificationCenterProps {
  userId: string;
}

const EVENT_ICONS: Record<string, typeof Bell> = {
  borrower_created: UserPlus,
  documents_uploaded: FileText,
  extraction_failure: AlertTriangle,
  manual_review_required: AlertTriangle,
  pre_approval_generated: Shield,
  submission_received: FileText,
};

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-amber-500',
  normal: 'border-l-teal-500',
  low: 'border-l-gray-300',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NotificationCenter({ userId }: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const [notifs, count] = await Promise.all([
        fetchNotifications(userId, 20),
        fetchUnreadCount(userId),
      ]);
      setNotifications(notifs);
      setUnreadCount(count);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const unsubscribe = subscribeToNotifications(userId, (newNotif) => {
      setNotifications(prev => [newNotif, ...prev].slice(0, 20));
      setUnreadCount(prev => prev + 1);
    });
    return unsubscribe;
  }, [userId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkRead = async (id: string) => {
    await markAsRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const handleMarkAllRead = async () => {
    await markAllAsRead(userId);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No notifications</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const IconComponent = EVENT_ICONS[notif.event_type] || Info;
                const priorityStyle = PRIORITY_STYLES[notif.priority || 'normal'] || PRIORITY_STYLES.normal;

                return (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 border-b border-gray-50 border-l-4 ${priorityStyle} ${
                      !notif.is_read ? 'bg-teal-50/40' : 'bg-white'
                    } hover:bg-gray-50 transition-colors`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 p-1.5 rounded-lg ${!notif.is_read ? 'bg-teal-100' : 'bg-gray-100'}`}>
                        <IconComponent className={`w-4 h-4 ${!notif.is_read ? 'text-teal-600' : 'text-gray-400'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${!notif.is_read ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                          {notif.title}
                        </p>
                        {notif.message && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">{timeAgo(notif.created_at)}</p>
                      </div>
                      {!notif.is_read && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMarkRead(notif.id); }}
                          className="p-1 text-gray-400 hover:text-teal-600 transition-colors"
                          title="Mark as read"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 text-center">
              <button
                onClick={() => setIsOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
