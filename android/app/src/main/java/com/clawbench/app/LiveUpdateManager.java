package com.clawbench.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

/**
 * Android 16 Live Updates — a promoted ongoing notification that surfaces the
 * ClawBench session state as a status-bar chip (the Android analogue of the
 * iOS Dynamic Island) plus an expanded-by-default, uncollapsible card on the
 * lock screen and at the top of the notification drawer.
 *
 * The chip shows a single, mutually-exclusive summary — pending approvals
 * first (most urgent: user action required), then running sessions, then
 * unread finished sessions. When nothing is left the chip stays visible in
 * an idle "空闲" state (mirroring the floating capsule), so the user always
 * has a glanceable status; only service shutdown removes it. The expanded
 * card always shows the counts for all three groups — "执行中 2 · 待审批 0 ·
 * 未读 3" — with the status-bar chip rendering the short single-group line
 * (contentTitle) and the expanded-by-default card showing the full breakdown
 * (contentText / BigTextStyle). Labels are loaded from string resources for
 * i18n.
 *
 * Data source parity with the floating window: the service feeds this manager
 * the same /api/ai/sessions/overview snapshots (on WS connect and on events)
 * that drive {@link FloatingStatusController}. {@link #computeStats} delegates
 * to {@link FloatingStatusController#computeStats(JSONObject)}, which itself
 * reuses the three pure overview parsers in {@link FloatingStatusView}, so the
 * Live Update chip and the floating capsule always agree on the numbers.
 *
 * Throttling: a {@link #THROTTLE_MS} merge window coalesces event-driven
 * refreshes, so a burst of session_update events triggers a single notify().
 * The system refreshes the `when`-driven elapsed time itself, so the chip
 * stays alive between refreshes without any app work.
 *
 * Promotion requirements (official docs): standard style (BigTextStyle here),
 * POST_PROMOTED_NOTIFICATIONS in the manifest, a request to be promoted, the
 * ongoing flag, a content title, no custom RemoteViews / group summary /
 * colorized, and a channel above IMPORTANCE_MIN. {@link #notifyInternal}
 * checks {@link NotificationManager#canPostPromotedNotifications()} and falls
 * back to a plain ongoing notification when promotion is unavailable (older
 * system, user disabled Live Updates, or the app lost the banner permission).
 *
 * All public methods are safe to call from any thread; notification posting is
 * marshalled to the main looper.
 */
public class LiveUpdateManager {

    private static final String TAG = "LiveUpdate";

    /** Notification channel for the live update card. */
    public static final String CHANNEL_ID = "clawbench_live_update";
    /** Single notification id — one chip summarizing the whole workspace. */
    public static final int NOTIFICATION_ID = 100;

    /** How long a burst of event-driven refreshes is merged into one notify(). */
    static final long THROTTLE_MS = 5000;

    /** Extra key requesting promoted treatment (EXTRA_REQUEST_PROMOTED_ONGOING
     *  value; not a public constant in the locally shipped android-36 jar). */
    private static final String EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing";

    private final Context appContext;
    private final Handler handler;
    private final NotificationManager notificationManager;

    /** Latest computed counts (pending > running > unread), for throttled coalescing. */
    private volatile int pendingCount;
    private volatile int runningCount;
    private volatile int unreadCount;
    /** Last time a notification was actually posted (throttle anchor). */
    private volatile long lastPostedMs;
    /** Whether a refresh is already scheduled within the throttle window. */
    private volatile boolean refreshScheduled;
    /** Whether a notification is currently visible. */
    private volatile boolean visible;

    public LiveUpdateManager(Context context) {
        this.appContext = context.getApplicationContext();
        this.handler = new Handler(Looper.getMainLooper());
        this.notificationManager =
                (NotificationManager) appContext.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    /**
     * Feed a fresh /api/ai/sessions/overview snapshot. Recomputes the three
     * counts and schedules a (possibly throttled) refresh. Any thread.
     */
    public void onOverviewLoaded(JSONObject overview) {
        if (overview == null) {
            return;
        }
        int[] stats = computeStats(overview);
        updateCounts(stats[0], stats[1], stats[2]);
    }

    /**
     * Feed a session_update / task_update event for count tracking. The event
     * alone does not carry unread counts, so only running/pending state is
     * adjusted here; the overview path reconciles all three. Any thread.
     *
     * Mirrors FloatingStatusController.trackSessionState semantics: active
     * states add the session, terminal states remove it. task_update is
     * ignored (its session_id is often empty and would desync the count).
     */
    public void onEvent(String eventType, String status, String sessionId) {
        if (!"session_update".equals(eventType)
                || sessionId == null || sessionId.isEmpty()) {
            return;
        }
        boolean active = FloatingStatusController.isActiveStatus(eventType, status);
        boolean pending = "permission_pending".equals(status);
        boolean terminal = "completed".equals(status) || "cancelled".equals(status)
                || "failed".equals(status);
        if (active) {
            runningSessions.add(sessionId);
            if (pending) {
                pendingSessions.add(sessionId);
            }
        } else if (terminal) {
            runningSessions.remove(sessionId);
            pendingSessions.remove(sessionId);
        } else if ("permission_resolved".equals(status)) {
            pendingSessions.remove(sessionId);
        }
        // Event-driven path can only update running/pending; unread stays as
        // the last overview reported it. The next overview reconciles.
        updateCounts(runningSessions.size() - pendingSessions.size(),
                pendingSessions.size(), unreadCount);
    }

    /**
     * Remove the live update notification and reset local state. Called on
     * service shutdown / feature toggle-off. Any thread.
     */
    public void destroy() {
        handler.post(() -> {
            refreshScheduled = false;
            visible = false;
            if (notificationManager != null) {
                notificationManager.cancel(NOTIFICATION_ID);
            }
        });
        runningSessions.clear();
        pendingSessions.clear();
    }

    /** True while a live update notification is currently visible. */
    public boolean isVisible() {
        return visible;
    }

    /** Latest pending count (most urgent group). */
    public int getPendingCount() {
        return pendingCount;
    }

    /** Latest running count. */
    public int getRunningCount() {
        return runningCount;
    }

    /** Latest unread count. */
    public int getUnreadCount() {
        return unreadCount;
    }

    // ------------------------------------------------------------------
    // Pure helpers (org.json + plain fields only — unit-testable without
    // an Android framework under plain JUnit).
    // ------------------------------------------------------------------

    /** The three workspace stats from an overview: {running, pending, unread}. */
    public static int[] computeStats(JSONObject overview) {
        return FloatingStatusController.computeStats(overview);
    }

    /**
     * The single summary line shown on the status-bar chip. Pending wins over
     * running, running wins over unread — only the most urgent group is shown,
     * because the chip fits a few characters at most. When every count is 0
     * the idle label is shown instead (the chip stays visible, like the
     * floating capsule's "空闲" state). Labels are injected for i18n. Pure:
     * only primitives.
     */
    public static String chipText(int running, int pending, int unread,
                                  String runningLabel, String pendingLabel,
                                  String unreadLabel, String idleLabel) {
        if (pending > 0) {
            return pendingLabel + " " + pending;
        }
        if (running > 0) {
            return runningLabel + " " + running;
        }
        if (unread > 0) {
            return unreadLabel + " " + unread;
        }
        return idleLabel;
    }

    /**
     * Expanded-card summary. While any session is active it always shows all
     * three counts (including zeros), e.g. "执行中 2 · 待审批 0 · 未读 3", so
     * the breakdown is predictable. When every count is 0 the idle label is
     * shown instead — a full "执行中 0 · 待审批 0 · 未读 0" would read as
     * noise for a state that is supposed to say "nothing going on".
     * Labels and the joiner are injected for i18n. Pure: only primitives.
     */
    public static String cardSummary(int running, int pending, int unread,
                                     String runningLabel, String pendingLabel,
                                     String unreadLabel, String joiner, String idleLabel) {
        if (pending == 0 && running == 0 && unread == 0) {
            return idleLabel;
        }
        return runningLabel + " " + running + joiner
                + pendingLabel + " " + pending + joiner
                + unreadLabel + " " + unread;
    }

    /**
     * Whether a refresh should be posted immediately. Pure: only primitives.
     * An empty workspace refreshes immediately (to the idle state — the chip
     * is never removed while the service runs); otherwise the first event is
     * immediate and subsequent ones within THROTTLE_MS are merged.
     */
    static boolean shouldRefresh(int running, int pending, int unread,
                                 boolean visible, long nowMs, long lastPostedMs) {
        if (pending == 0 && running == 0 && unread == 0) {
            return true; // idle transition — show it right away
        }
        if (!visible) {
            return true; // first appearance is always immediate
        }
        return nowMs - lastPostedMs >= THROTTLE_MS;
    }

    // ------------------------------------------------------------------
    // Internal state + posting
    // ------------------------------------------------------------------

    private final java.util.Set<String> runningSessions =
            java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final java.util.Set<String> pendingSessions =
            java.util.concurrent.ConcurrentHashMap.newKeySet();

    private void updateCounts(int running, int pending, int unread) {
        boolean changed = running != runningCount || pending != pendingCount
                || unread != unreadCount;
        runningCount = running;
        pendingCount = pending;
        unreadCount = unread;
        if (!changed && visible) {
            return;
        }
        handler.post(this::scheduleRefresh);
    }

    private void scheduleRefresh() {
        if (refreshScheduled) {
            return;
        }
        long now = System.currentTimeMillis();
        if (shouldRefresh(runningCount, pendingCount, unreadCount,
                visible, now, lastPostedMs)) {
            refreshScheduled = false;
            doRefresh();
            return;
        }
        refreshScheduled = true;
        long delay = lastPostedMs + THROTTLE_MS - now;
        handler.postDelayed(() -> {
            refreshScheduled = false;
            doRefresh();
        }, Math.max(0, delay));
    }

    private void doRefresh() {
        lastPostedMs = System.currentTimeMillis();
        // Even an empty workspace keeps the chip visible in an idle "空闲"
        // state (mirroring the floating capsule); only destroy() removes it.
        visible = true;
        String idle = appContext.getString(R.string.live_update_idle);
        notifyInternal(
                chipText(runningCount, pendingCount, unreadCount,
                        appContext.getString(R.string.live_update_running),
                        appContext.getString(R.string.live_update_pending),
                        appContext.getString(R.string.live_update_unread),
                        idle),
                cardSummary(runningCount, pendingCount, unreadCount,
                        appContext.getString(R.string.live_update_running),
                        appContext.getString(R.string.live_update_pending),
                        appContext.getString(R.string.live_update_unread),
                        appContext.getString(R.string.live_update_joiner),
                        idle));
    }

    /**
     * Build and post the live update notification. On API 36+ with promotion
     * available this is a promoted ongoing notification (status-bar chip); on
     * older systems or when promotion is denied it degrades to a plain ongoing
     * notification. Main thread only.
     */
    private void notifyInternal(String chip, String summary) {
        if (notificationManager == null) {
            return;
        }
        ensureChannel();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(appContext, CHANNEL_ID)
                // The launcher icon (auto-rendered as a monochrome silhouette
                // by the system for status-bar small icons) shows the app's own
                // mark on the chip instead of a generic notification glyph.
                .setSmallIcon(R.mipmap.ic_launcher)
                // ColorOS fluid cloud (and most OEM chips) render the status
                // text from contentTitle, so the live status goes there. The
                // expanded card shows the full breakdown via contentText /
                // BigTextStyle.
                .setContentTitle(chip)
                .setContentText(summary)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(summary))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(buildTapIntent());

        if (Build.VERSION.SDK_INT >= 36) {
            // Request promotion to a Live Update (status-bar chip). The extra
            // key matches EXTRA_REQUEST_PROMOTED_ONGOING; the locally shipped
            // android-36 jar predates the 36.1 constant, hence the literal.
            builder.setPriority(NotificationCompat.PRIORITY_LOW);
            builder.getExtras().putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true);
        }

        Notification notification = builder.build();
        // Only claim FLAG_PROMOTED_ONGOING on API 36+; canPostPromotedNotifications
        // tells us whether the system will actually promote it.
        boolean promoted = canPostPromoted(appContext);
        AppLog.d(TAG, "posting live update: chip=\"" + chip + "\" summary=\"" + summary
                + "\" promoted=" + promoted + " (sdk=" + Build.VERSION.SDK_INT + ")");
        notificationManager.notify(NOTIFICATION_ID, notification);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        if (notificationManager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                appContext.getString(R.string.notif_channel_live_update),
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(appContext.getString(R.string.notif_channel_live_update_desc));
        channel.setShowBadge(false);
        notificationManager.createNotificationChannel(channel);
    }

    private PendingIntent buildTapIntent() {
        Intent intent = new Intent(appContext, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                appContext, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ------------------------------------------------------------------
    // Promotion support / settings navigation
    // ------------------------------------------------------------------

    /**
     * Whether the system will actually promote a Live Updates request right
     * now. On Android 16+ this reflects canPostPromotedNotifications() (which
     * accounts for the user's Live Updates setting and the app's permission);
     * on older systems promotion is unavailable, so this is false.
     */
    public static boolean canPostPromoted(Context context) {
        if (Build.VERSION.SDK_INT < 36) {
            return false;
        }
        NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.canPostPromotedNotifications();
    }

    /**
     * Open the system screen where the user can enable Live Updates for this
     * app. Tries the promotion-specific actions in order, falling back to the
     * app notification settings screen (which exists on every device) when a
     * specific action is missing or throws.
     *
     * @param context an Activity context (the settings screen is launched from
     *                it); null-safe and exception-safe.
     */
    public static void openPromotedSettings(Context context) {
        if (context == null) {
            return;
        }
        String pkg = context.getPackageName();
        // Known promotion-settings actions, most specific first. The exact
        // action name varies across Android versions / OEMs (the documented
        // ACTION_MANAGE_APP_PROMOTED_NOTIFICATIONS does not exist on some
        // builds, where ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS is the real
        // one), so probe each and fall through on failure.
        String[] promotionActions = {
                "android.settings.MANAGE_APP_PROMOTED_NOTIFICATIONS",
                "android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS",
        };
        for (String action : promotionActions) {
            try {
                Intent intent = new Intent(action, Uri.parse("package:" + pkg));
                if (context.getPackageManager().resolveActivity(intent, 0) != null) {
                    context.startActivity(intent);
                    return;
                }
            } catch (Exception e) {
                AppLog.w(TAG, "promoted settings action unavailable: " + action, e);
            }
        }
        // Fallback: the per-app notification settings screen exists everywhere.
        try {
            Intent fallback = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
            context.startActivity(fallback);
        } catch (Exception e) {
            AppLog.w(TAG, "failed to open notification settings", e);
        }
    }
}
