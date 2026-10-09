package cn.himpqblog.nexoraapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

/**
 * Keeps a user-started answer update visible while Nexora is in the background.
 */
public final class NexoraLiveUpdateService extends Service {
    private static final String TAG = "NexoraLiveUpdate";
    private static final String CHANNEL_ID = "nexora_answer_progress";
    private static final String ACTION_START = "cn.himpqblog.nexoraapp.action.START_ANSWER";
    private static final String ACTION_UPDATE = "cn.himpqblog.nexoraapp.action.UPDATE_ANSWER";
    private static final String ACTION_FINISH = "cn.himpqblog.nexoraapp.action.FINISH_ANSWER";
    private static final String ACTION_STOP = "cn.himpqblog.nexoraapp.action.STOP_ANSWER";
    private static final String EXTRA_PROGRESS_TEXT = "progress_text";
    private static final String EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing";
    // AndroidX Core writes this field when the compile SDK does not expose the API 36 setter.
    private static final String EXTRA_SHORT_CRITICAL_TEXT = "android.shortCriticalText";
    private static final int NOTIFICATION_ID = 7210;
    private static final long FINISH_DISPLAY_MS = 5000L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean foreground = false;
    private boolean completed = false;
    private String progressText = "正在生成回复";

    private final Runnable removeFinishedNotification = () -> {
        if (foreground) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            foreground = false;
        } else {
            getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        }

        completed = false;
        stopSelf();
    };

    public static void start(Context context, String initialProgressText) {
        Intent intent = createIntent(context, ACTION_START);
        intent.putExtra(EXTRA_PROGRESS_TEXT, initialProgressText);
        context.startForegroundService(intent);
    }

    public static void update(Context context, String newProgressText) {
        Intent intent = createIntent(context, ACTION_UPDATE);
        intent.putExtra(EXTRA_PROGRESS_TEXT, newProgressText);
        context.startService(intent);
    }

    public static void finish(Context context) {
        context.startService(createIntent(context, ACTION_FINISH));
    }

    public static void stop(Context context) {
        context.startService(createIntent(context, ACTION_STOP));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        String action = intent.getAction();

        if (ACTION_START.equals(action)) {
            startAnswerNotification(intent);
        } else if (ACTION_UPDATE.equals(action)) {
            updateAnswerNotification(intent);
        } else if (ACTION_FINISH.equals(action)) {
            finishAnswerNotification(startId);
        } else if (ACTION_STOP.equals(action)) {
            stopAnswerNotification(startId);
        } else {
            Log.e(TAG, "Unknown foreground service action");
            stopSelf(startId);
        }

        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(removeFinishedNotification);
        super.onDestroy();
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "回答生成",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("显示正在生成的 AI 回复进度");
        channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    /**
     * Promotes the generation notification as an Android Live Update request.
     */
    private void startAnswerNotification(Intent intent) {
        mainHandler.removeCallbacks(removeFinishedNotification);
        completed = false;
        progressText = readProgressText(intent, "正在生成回复");
        startForeground(NOTIFICATION_ID, buildNotification(progressText, true));
        foreground = true;
        Log.i(TAG, "Answer progress notification started");
    }

    private void updateAnswerNotification(Intent intent) {
        if (!foreground) {
            Log.w(TAG, "Ignored progress update before foreground service start");
            return;
        }

        if (completed) {
            Log.w(TAG, "Ignored progress update after completion");
            return;
        }

        progressText = readProgressText(intent, progressText);
        getSystemService(NotificationManager.class).notify(
                NOTIFICATION_ID,
                buildNotification(progressText, true));
    }

    private void finishAnswerNotification(int startId) {
        if (!foreground) {
            stopSelf(startId);
            return;
        }

        mainHandler.removeCallbacks(removeFinishedNotification);
        // Keep the promoted foreground notification active through the completion hold.
        completed = true;
        getSystemService(NotificationManager.class).notify(
                NOTIFICATION_ID,
                buildNotification("回复已完成", false));
        mainHandler.postDelayed(removeFinishedNotification, FINISH_DISPLAY_MS);
        Log.i(TAG, "Answer progress notification finished");
    }

    private void stopAnswerNotification(int startId) {
        mainHandler.removeCallbacks(removeFinishedNotification);
        completed = false;

        if (foreground) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            foreground = false;
        } else {
            getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        }

        stopSelf(startId);
        Log.i(TAG, "Answer progress notification stopped");
    }

    private Notification buildNotification(String contentText, boolean generating) {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                NOTIFICATION_ID,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.arkuix)
                .setContentTitle(generating ? "Nexora 正在回答" : "Nexora")
                .setContentText(contentText)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setLocalOnly(true)
                .setShowWhen(false)
                .setProgress(0, 0, generating);

        Bundle extras = new Bundle();
        extras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true);
        extras.putString(EXTRA_SHORT_CRITICAL_TEXT, contentText);
        builder.addExtras(extras);

        return builder.build();
    }

    private String readProgressText(Intent intent, String defaultText) {
        String value = intent.getStringExtra(EXTRA_PROGRESS_TEXT);

        if (value == null || value.length() == 0) {
            return defaultText;
        }

        return value;
    }

    private static Intent createIntent(Context context, String action) {
        Intent intent = new Intent(context, NexoraLiveUpdateService.class);
        intent.setAction(action);
        return intent;
    }
}
