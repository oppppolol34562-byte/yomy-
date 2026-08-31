package com.yomy.permissions;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class YomyMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "messages";
    private static final String GROUP_KEY = "yomy_messages";
    private static final String PREFS = "yomy_notification_history";
    private static final int SUMMARY_ID = 0x594F4D59;

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) return;
        String chatId = valueOr(data.get("chat_id"), data.get("sender_username"));
        String sender = valueOr(data.get("sender_username"), "New message");
        String body = valueOr(data.get("body"), "New message");
        String url = valueOr(data.get("url"), "/messages");
        String messageId = valueOr(data.get("message_id"), remoteMessage.getMessageId());
        if (chatId.isEmpty()) chatId = sender;
        createHighImportanceChannel();
        JSONArray history = appendHistory(chatId, sender, body);
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(sender);
        style.setConversationTitle(sender);
        for (int index = 0; index < history.length(); index++) {
            try {
                JSONObject item = history.getJSONObject(index);
                style.addMessage(item.optString("body", "New message"), item.optLong("time", System.currentTimeMillis()), item.optString("sender", sender));
            } catch (JSONException ignored) { }
        }
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle(sender)
                .setContentText(body)
                .setStyle(style)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setGroup(GROUP_KEY)
                .setNumber(history.length())
                .setContentIntent(createContentIntent(url, chatId, messageId));
        try { NotificationManagerCompat.from(this).notify(Math.abs(("chat:" + chatId).hashCode()), builder.build()); }
        catch (SecurityException ignored) { }
        updateGroupSummary();
    }

    private String valueOr(String value, String fallback) { return value == null || value.trim().isEmpty() ? fallback : value; }

    private JSONArray appendHistory(String chatId, String sender, String body) {
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String key = "history_" + chatId;
        JSONArray history;
        try { history = new JSONArray(preferences.getString(key, "[]")); }
        catch (JSONException error) { history = new JSONArray(); }
        JSONObject item = new JSONObject();
        try {
            item.put("sender", sender);
            item.put("body", body);
            item.put("time", System.currentTimeMillis());
            history.put(item);
        } catch (JSONException ignored) { return history; }
        while (history.length() > 8) history.remove(0);
        Set<String> chats = new HashSet<>(preferences.getStringSet("active_chats", new HashSet<>()));
        chats.add(chatId);
        preferences.edit().putString(key, history.toString()).putStringSet("active_chats", chats).apply();
        return history;
    }

    private PendingIntent createContentIntent(String url, String chatId, String messageId) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setClassName(getPackageName(), getPackageName() + ".MainActivity");
        intent.putExtra("yomy_notification_url", url);
        intent.putExtra("yomy_chat_id", chatId);
        intent.putExtra("google.message_id", valueOr(messageId, "yomy-" + chatId));
        intent.putExtra("url", url);
        intent.setData(Uri.parse("yomy://messages/" + chatId));
        int requestCode = Math.abs(("open:" + chatId).hashCode());
        return PendingIntent.getActivity(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void createHighImportanceChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("New chat messages");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 250, 150, 250 });
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        manager.createNotificationChannel(channel);
    }

    private void updateGroupSummary() {
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        Set<String> chats = preferences.getStringSet("active_chats", new HashSet<>());
        if (chats.size() < 2) return;
        NotificationCompat.Builder summary = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle("Yomy messages")
                .setContentText(chats.size() + " conversations")
                .setStyle(new NotificationCompat.InboxStyle().setSummaryText(chats.size() + " conversations"))
                .setGroup(GROUP_KEY)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH);
        try { NotificationManagerCompat.from(this).notify(SUMMARY_ID, summary.build()); }
        catch (SecurityException ignored) { }
    }
}
