package com.yomy.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        dispatchNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchNotificationIntent(intent);
    }

    private void dispatchNotificationIntent(Intent intent) {
        if (intent == null) return;
        String url = intent.getStringExtra("yomy_notification_url");
        if (url == null || !url.startsWith("/")) return;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            String safeUrl = JSONObject.quote(url);
            String script = "window.__yomyPendingNotificationUrl = " + safeUrl + ";" +
                    "window.dispatchEvent(new CustomEvent('yomy:notification-open',{detail:{url:" + safeUrl + "}}));";
            getBridge().getWebView().evaluateJavascript(script, null);
        }, 1000);
    }
}
