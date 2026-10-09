package cn.himpqblog.nexoraapp;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;

import ohos.stage.ability.adapter.StageActivity;


/**
 * ArkUI-X 跨平台 Activity。
 * 系统栏颜色由 EntryAbility.setWindowSystemBarProperties 配置，此处补充深色文字图标。
 * 键盘避让：SurfaceView 不响应 adjustResize，故手动监听 insets 设置 contentView padding，
 * 让 SurfaceView 随键盘高度缩小，实现等价 RESIZE 效果。
 */
public class MainActivity extends StageActivity {
    private static final String TAG = "NexoraLiveUpdate";
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 7821;

    private boolean answerGenerationActive = false;
    private boolean liveUpdateServiceStarted = false;
    private boolean notificationPermissionRequestPending = false;
    private boolean notificationPermissionDeclinedForGeneration = false;
    private String answerProgressText = "正在生成回复";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Log.e("HiHelloWorld", "MainActivity");
        addPlugin("cn.himpqblog.nexoraapp.NexoraLiveUpdatePlugin");
        setInstanceName("cn.himpqblog.nexoraapp:entry:EntryAbility:");
        super.onCreate(savedInstanceState);
        setupSystemBars();
        setupKeyboardResize();
    }

    /**
     * Starts a user-initiated Android live update while the chat screen is visible.
     */
    public void startAnswerGeneration() {
        runOnUiThread(() -> {
            if (!answerGenerationActive) {
                answerGenerationActive = true;
                notificationPermissionDeclinedForGeneration = false;
                answerProgressText = "正在生成回复";
            }

            if (liveUpdateServiceStarted || notificationPermissionRequestPending
                    || notificationPermissionDeclinedForGeneration) {
                return;
            }

            startLiveUpdateIfAllowed();
        });
    }

    /**
     * Updates only the generated character count; response text stays out of the notification.
     */
    public void updateAnswerProgress(String progressText) {
        runOnUiThread(() -> {
            if (!answerGenerationActive) {
                return;
            }

            answerProgressText = progressText;

            if (liveUpdateServiceStarted) {
                NexoraLiveUpdateService.update(this, answerProgressText);
            }
        });
    }

    /**
     * Shows a brief completion state, then lets the service remove its notification.
     */
    public void finishAnswerGeneration() {
        runOnUiThread(() -> {
            if (!answerGenerationActive) {
                return;
            }

            answerGenerationActive = false;
            notificationPermissionRequestPending = false;

            if (liveUpdateServiceStarted) {
                liveUpdateServiceStarted = false;
                NexoraLiveUpdateService.finish(this);
            }
        });
    }

    /**
     * Removes the live update immediately after cancellation or a stream error.
     */
    public void stopAnswerGeneration() {
        runOnUiThread(() -> {
            answerGenerationActive = false;
            notificationPermissionRequestPending = false;
            notificationPermissionDeclinedForGeneration = false;

            if (liveUpdateServiceStarted) {
                liveUpdateServiceStarted = false;
                NexoraLiveUpdateService.stop(this);
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode != NOTIFICATION_PERMISSION_REQUEST_CODE) {
            return;
        }

        notificationPermissionRequestPending = false;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;

        if (granted && answerGenerationActive) {
            startLiveUpdateService();
            return;
        }

        notificationPermissionDeclinedForGeneration = true;
        Log.w(TAG, "Notification permission was denied; live update was not started");
    }

    private void startLiveUpdateIfAllowed() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermissionRequestPending = true;
            requestPermissions(
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    NOTIFICATION_PERMISSION_REQUEST_CODE);
            Log.i(TAG, "Requested notification permission for answer progress");
            return;
        }

        startLiveUpdateService();
    }

    private void startLiveUpdateService() {
        try {
            NexoraLiveUpdateService.start(this, answerProgressText);
            liveUpdateServiceStarted = true;
            Log.i(TAG, "Answer progress foreground service started");
        } catch (RuntimeException error) {
            liveUpdateServiceStarted = false;
            Log.e(TAG, "Answer progress foreground service could not start", error);
        }
    }

    /**
     * 状态栏/导航栏深色文字图标。
     * setWindowSystemBarProperties 不映射 statusBarContentColor 到 Android，需在此补充。
     */
    private void setupSystemBars() {
        View decorView = getWindow().getDecorView();
        int flags = decorView.getSystemUiVisibility();
        flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decorView.setSystemUiVisibility(flags);
    }

    /**
     * 手动键盘 resize：监听 WindowInsets，将系统栏 + 键盘高度设为 contentView padding。
     * SurfaceView 随 padding 缩小，内容区域等价 adjustResize。
     * contentView 背景设为白色，padding 区域不露黑边。
     */
    private void setupKeyboardResize() {
        Window window = getWindow();
        View content = findViewById(android.R.id.content);
        if (content == null) {
            return;
        }

        content.setBackgroundColor(Color.WHITE);

        View decorView = window.getDecorView();
        decorView.setOnApplyWindowInsetsListener((v, insets) -> {
            int top = insets.getSystemWindowInsetTop();
            int bottom = insets.getSystemWindowInsetBottom();
            content.setPadding(0, top, 0, bottom);
            return insets;
        });
        decorView.requestApplyInsets();
    }
}
