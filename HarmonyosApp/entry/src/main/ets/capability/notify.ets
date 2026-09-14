/**
 * §9.3 本地通知（#16）：决策器触发时发出，文案遵守 §7。
 * 事实依据（devecocli docs Notification Kit FAQ）：
 * - 首次需 requestEnableNotification() 弹窗请求授权（仅弹一次）
 * - notificationManager.publish(NotificationRequest)；普通文本用
 *   ContentType.NOTIFICATION_CONTENT_TYPE_BASIC_TEXT + normal{title, text}
 */
import { notificationManager } from '@kit.NotificationKit';

export class NotifyService {
  async ensureEnabled(): Promise<void> {
    try {
      await notificationManager.requestEnableNotification();
    } catch (err) {
      // 拒绝授权则静默：不打扰主线
    }
  }

  async publish(id: number, title: string, text: string): Promise<void> {
    const request: notificationManager.NotificationRequest = {
      id: id,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: {
          title: title,
          text: text,
        },
      },
    };
    try {
      await notificationManager.publish(request);
    } catch (err) {
      // 通知开关关闭时静默失败（FAQ faqs-notification-kit-8）
    }
  }
}

export const sharedNotify: NotifyService = new NotifyService();
