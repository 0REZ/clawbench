# Android 16 Live Updates (Dynamic Island)

On Android 16+, the ClawBench Android app uses **Live Updates** (promoted ongoing notifications) to surface the workspace session state — running / pending-approval / unread counts — as a persistent status-bar chip and lock-screen card, similar to iOS's Dynamic Island.

---

## What it is

Live Updates is a notification type introduced in Android 16 (API 36) that promotes an **ongoing activity** to a status-bar chip plus a card pinned to the top of the notification drawer / lock screen:

- Status-bar chip: icon + short text (e.g. "Running 2"), always visible
- Expanded card: expanded by default, uncollapsible, shows the full breakdown (e.g. "Running 2 · Awaiting approval 0 · Unread 3")
- The notification must be `ongoing`; the user cannot swipe it away

ClawBench uses it to show the workspace session state at a glance without opening the app.

## What each vendor calls it

Different vendors wrap the same Android 16 Live Updates standard in their own UI and names:

| Vendor | Official name | Notes |
|--------|--------------|-------|
| Google / Pixel | **Live Updates** | Native naming since Android 16 |
| Apple (iOS) | **Dynamic Island** | Origin of the "灵动岛" term, iPhone 14 Pro |
| OPPO / OnePlus (ColorOS/OxygenOS) | **Fluid Cloud** (流体云) | Full integration with Google's Live Updates API; third-party apps adapt by following the spec |
| Samsung (One UI) | **Now Bar** | Lock-screen bottom pill |
| Xiaomi (HyperOS) | **灵动岛 / real-time notification** | Punch-hole capsule |
| vivo (OriginOS) | **Atoms** (原子通知) | Punch-hole / capsule lightweight notifications |
| Huawei (HarmonyOS) | **Live Window** (实况窗) | Proprietary system |
| Honor (MagicOS) | **Magic Capsule** (灵动胶囊) | Punch-hole capsule |

## Technical details

### Hard requirements to be a Live Update

1. Standard style: `BigTextStyle` / `ProgressStyle` / `MetricStyle` / `CallStyle`
2. Manifest declares the non-runtime permission `android.permission.POST_PROMOTED_NOTIFICATIONS`
3. Explicitly request promotion: `EXTRA_REQUEST_PROMOTED_ONGOING` or `NotificationCompat.Builder#setRequestPromotedOngoing`
4. Must be `ongoing` (`FLAG_ONGOING_EVENT`)
5. Must have a `contentTitle`
6. No RemoteViews, no `setGroupSummary`, no `setColorized(true)`
7. Channel must not be `IMPORTANCE_MIN`

### Key APIs

| API | Purpose |
|-----|---------|
| `NotificationManager.canPostPromotedNotifications()` | Whether the app can currently post a promoted notification |
| `Notification.hasPromotableCharacteristics()` | Whether the notification is eligible for promotion |
| `Notification.FLAG_PROMOTED_ONGOING` | Whether the notification was promoted |
| `Settings.ACTION_MANAGE_APP_PROMOTED_NOTIFICATIONS` | Open the Live Updates permission screen (missing on some ROMs) |
| `Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS` | The promotion-settings action that exists on some builds |

### Permission (important)

Live Updates requires the user to enable it in system settings, and **each ROM has its own separate authorization switch**:

- **AOSP / Pixel**: "Live Updates / promoted notifications" permission in notification settings
- **ColorOS Fluid Cloud**: **off by default for third-party apps**; must be enabled per-app in Settings → Notifications → Fluid Cloud
- **Samsung Now Bar**, **vivo Atoms**, etc. likewise

**When not authorized**: `canPostPromotedNotifications()` returns `false` and the notification degrades to a plain ongoing notification (no status-bar chip). When the user enables the "Live Updates" toggle in ClawBench settings without permission, the app automatically opens the matching permission screen.

### ClawBench implementation

- Independent setting: "Live Updates" toggle (`live_update_enabled`, on by default), independent of the "Floating Status Window" toggle
- Shares the `/api/ai/sessions/overview` snapshot and WS event stream with the floating window
- Mutually exclusive chip priority: pending-approval > running > unread (chip shows only the most urgent)
- Expanded card always shows all three counts (including zeros)
- When nothing is active the chip is removed (the status bar stays clean until the next session becomes active)
- 5s throttle coalesces refreshes; elapsed time is driven by the system's `when` field, so power cost is minimal

## Related code

- `android/app/src/main/java/com/clawbench/app/LiveUpdateManager.java` — core implementation
- `android/app/src/main/java/com/clawbench/app/BackgroundService.java` — event stream and toggle wiring
- `android/app/src/main/java/com/clawbench/app/MainActivity.java` — JSBridge (`setLiveUpdateEnabled` / `canPostPromotedNotifications` / `openLiveUpdateSettings`)
- `web/src/composables/useSettingsConfig.ts` — settings item
