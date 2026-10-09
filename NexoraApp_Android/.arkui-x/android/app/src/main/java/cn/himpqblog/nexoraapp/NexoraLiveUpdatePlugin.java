package cn.himpqblog.nexoraapp;

import android.content.Context;
import android.util.Log;

import ohos.ace.adapter.IArkUIXPlugin;
import ohos.ace.adapter.PluginContext;
import ohos.ace.adapter.capability.bridge.BridgePlugin;

/**
 * Registers the Android bridge for ongoing answer notifications.
 */
public final class NexoraLiveUpdatePlugin implements IArkUIXPlugin {
    private static final String TAG = "NexoraLiveUpdate";

    private BridgePlugin bridge;

    @Override
    public void onRegistry(PluginContext pluginContext) {
        Context context = pluginContext.getContext();

        if (!(context instanceof MainActivity)) {
            throw new IllegalStateException("Live update bridge requires MainActivity context");
        }

        bridge = new NexoraLiveUpdateBridge(
                (MainActivity) context,
                pluginContext.getBridgeManager());
        Log.i(TAG, "ArkUI-X live update bridge registered");
    }

    @Override
    public void onUnRegistry(PluginContext pluginContext) {
        if (bridge != null) {
            bridge.release();
            bridge = null;
            Log.i(TAG, "ArkUI-X live update bridge released");
        }
    }
}
