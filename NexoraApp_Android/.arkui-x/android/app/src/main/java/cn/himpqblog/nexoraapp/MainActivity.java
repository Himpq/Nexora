package cn.himpqblog.nexoraapp;

import android.graphics.Color;
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
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Log.e("HiHelloWorld", "MainActivity");
        setInstanceName("cn.himpqblog.nexoraapp:entry:EntryAbility:");
        super.onCreate(savedInstanceState);
        setupSystemBars();
        setupKeyboardResize();
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
