package cn.himpqblog.nexoraapp;

import ohos.ace.adapter.capability.bridge.BridgeManager;
import ohos.ace.adapter.capability.bridge.BridgePlugin;

/**
 * Exposes answer-generation lifecycle calls from ArkTS to the Android activity.
 */
public final class NexoraLiveUpdateBridge extends BridgePlugin {
    private final MainActivity activity;

    public NexoraLiveUpdateBridge(MainActivity activity, BridgeManager bridgeManager) {
        super(activity, "NexoraLiveUpdate", bridgeManager);
        this.activity = activity;
    }

    public void startGenerating() {
        activity.startAnswerGeneration();
    }

    public void updateContent(String progressText) {
        activity.updateAnswerProgress(progressText);
    }

    public void finishGenerating() {
        activity.finishAnswerGeneration();
    }

    public void stop() {
        activity.stopAnswerGeneration();
    }
}
