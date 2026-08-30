package com.clawbench.app;

import android.content.Context;
import android.content.res.Configuration;

import java.util.Locale;

/**
 * Resolves string resources in the user's in-app language for native UI that
 * is not part of an attached Activity (floating window views owned by
 * BackgroundService). The Web frontend persists the choice in the
 * user_language pref via the setLanguage bridge; falls back to the default
 * resource (system locale) when no preference is set or on any error.
 */
final class UserLanguage {

    static final String PREFS_NAME = "clawbench_prefs";
    static final String KEY_USER_LANGUAGE = "user_language";

    private UserLanguage() {
    }

    /** The user's in-app language: "zh", "en", or null when unset. */
    static String get(Context context) {
        try {
            String lang = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .getString(KEY_USER_LANGUAGE, "");
            return ("zh".equals(lang) || "en".equals(lang)) ? lang : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Resolve resId in the user's in-app language, with system-locale fallback. */
    static String resolve(Context context, int resId, Object... formatArgs) {
        String lang = get(context);
        if (lang == null) {
            return formatArgs.length > 0
                    ? context.getString(resId, formatArgs) : context.getString(resId);
        }
        try {
            Configuration config = new Configuration(context.getResources().getConfiguration());
            config.setLocale("zh".equals(lang) ? Locale.SIMPLIFIED_CHINESE : Locale.ENGLISH);
            Context localized = context.createConfigurationContext(config);
            return formatArgs.length > 0
                    ? localized.getString(resId, formatArgs) : localized.getString(resId);
        } catch (Exception e) {
            return formatArgs.length > 0
                    ? context.getString(resId, formatArgs) : context.getString(resId);
        }
    }
}
