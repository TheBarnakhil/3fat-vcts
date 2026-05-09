package com.threefat.vcts.tracking

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.threefat.vcts.MainActivity
import com.threefat.vcts.R

/**
 * Builds the persistent "active duty" notification that the foreground
 * tracker service must display while running. Centralised so the
 * channel id + small icon stay consistent across app upgrades.
 *
 * Channel id is `vcts_active_duty`; the user can mute the notification
 * from system settings without affecting the service itself.
 */
internal object TrackingNotifications {
    const val CHANNEL_ID = "vcts_active_duty"
    const val NOTIFICATION_ID = 4201

    fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.tracking_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(R.string.tracking_channel_description)
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    fun build(
        context: Context,
        contentText: String,
    ): Notification {
        ensureChannel(context)
        val openApp = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher_round)
            .setContentTitle(context.getString(R.string.tracking_notification_title))
            .setContentText(contentText)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openApp)
            .build()
    }
}
