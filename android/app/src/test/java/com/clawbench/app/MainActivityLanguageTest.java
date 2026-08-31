package com.clawbench.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;

import static org.junit.Assert.*;

/**
 * Unit tests for MainActivity.resolveUserLanguage() — the in-app language
 * resolution used by the splash page and the login page bridge.
 *
 * The language follows the clawbench-locale cookie (written by the Web
 * frontend when the user switches language), port-scoped as
 * cb{port}_clawbench-locale on non-default ports, with a system-locale
 * fallback when no cookie is present.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class MainActivityLanguageTest {

    private static final String SERVER_URL = "http://192.168.1.100:20000";

    private MainActivity activity;
    private SharedPreferences prefs;
    private CookieManager cookieManager;

    @Before
    public void setUp() throws Exception {
        activity = allocate(MainActivity.class);
        Field instanceField = MainActivity.class.getDeclaredField("instance");
        instanceField.setAccessible(true);
        instanceField.set(null, activity);

        prefs = RuntimeEnvironment.getApplication()
                .getSharedPreferences("clawbench_prefs", Context.MODE_PRIVATE);
        prefs.edit().clear().commit();
        setField(activity, "prefs", prefs);

        cookieManager = CookieManager.getInstance();
        cookieManager.removeAllCookie();
    }

    @After
    public void tearDown() throws Exception {
        try {
            Field instanceField = MainActivity.class.getDeclaredField("instance");
            instanceField.setAccessible(true);
            instanceField.set(null, null);
        } catch (Exception ignored) {}
    }

    @Test
    public void resolveUserLanguage_cookieZh_returnsZh() throws Exception {
        prefs.edit().putString("server_url", SERVER_URL).commit();
        cookieManager.setCookie(SERVER_URL, "clawbench-locale=zh");

        assertEquals("zh", activity.resolveUserLanguage());
    }

    @Test
    public void resolveUserLanguage_cookieEn_returnsEn() throws Exception {
        prefs.edit().putString("server_url", SERVER_URL).commit();
        cookieManager.setCookie(SERVER_URL, "clawbench-locale=en");

        assertEquals("en", activity.resolveUserLanguage());
    }

    @Test
    public void resolveUserLanguage_scopedPortCookie_wins() throws Exception {
        String scopedServer = "http://192.168.1.100:20300";
        prefs.edit().putString("server_url", scopedServer).commit();
        // Both plain and port-scoped cookies present: the port-scoped one
        // (cb20300_clawbench-locale) must win for the non-default port.
        // (Two setCookie calls — Robolectric drops extra cookies in one call.)
        cookieManager.setCookie(scopedServer, "clawbench-locale=zh");
        cookieManager.setCookie(scopedServer, "cb20300_clawbench-locale=en");

        assertEquals("en", activity.resolveUserLanguage());
    }

    @Test
    public void resolveUserLanguage_noCookie_fallsBackToSystemLocale() throws Exception {
        prefs.edit().putString("server_url", SERVER_URL).commit();
        // No cookie set.

        assertEquals(java.util.Locale.getDefault().getLanguage(),
                activity.resolveUserLanguage());
    }

    @Test
    public void resolveUserLanguage_noServerUrl_fallsBackToSystemLocale() throws Exception {
        // server_url not persisted — cookie lookup must be skipped safely.
        cookieManager.setCookie(SERVER_URL, "clawbench-locale=zh");

        assertEquals(java.util.Locale.getDefault().getLanguage(),
                activity.resolveUserLanguage());
    }

    @Test
    public void getLanguageBridge_returnsZhCookie() throws Exception {
        prefs.edit().putString("server_url", SERVER_URL).commit();
        cookieManager.setCookie(SERVER_URL, "clawbench-locale=zh");

        MainActivity.WebAppInterface bridge = allocate(MainActivity.WebAppInterface.class);
        setField(bridge, "activity", activity);
        assertEquals("zh", bridge.getLanguage());
    }

    @Test
    public void setLanguageBridge_persistsPrefs() throws Exception {
        MainActivity.WebAppInterface bridge = allocate(MainActivity.WebAppInterface.class);
        setField(bridge, "activity", activity);

        bridge.setLanguage("en");
        assertEquals("en", prefs.getString("user_language", ""));

        bridge.setLanguage("fr");
        assertEquals("en", prefs.getString("user_language", "")); // invalid ignored
    }

    @Test
    public void resolveUserLanguage_prefsWinsOverCookie() throws Exception {
        // setLanguage persisted "en" to prefs, but the cookie says zh — prefs wins.
        prefs.edit().putString("server_url", SERVER_URL).commit();
        prefs.edit().putString("user_language", "en").commit();
        cookieManager.setCookie(SERVER_URL, "clawbench-locale=zh");

        assertEquals("en", activity.resolveUserLanguage());
    }

    @Test
    public void resolveUserLanguage_prefsNoServerUrl_returnsPrefs() throws Exception {
        // No server_url persisted, but user_language exists — must still return it.
        prefs.edit().putString("user_language", "zh").commit();

        assertEquals("zh", activity.resolveUserLanguage());
    }

    @Test
    public void userLangString_enCookie_returnsEnglishSplashText() throws Exception {
        // A real attached activity so getResources()/createConfigurationContext work.
        MainActivity attached = Robolectric.buildActivity(MainActivity.class).get();
        setField(attached, "prefs", prefs);
        Field instanceField = MainActivity.class.getDeclaredField("instance");
        instanceField.setAccessible(true);
        instanceField.set(null, attached);

        prefs.edit().putString("server_url", SERVER_URL).commit();
        cookieManager.setCookie(SERVER_URL, "clawbench-locale=en");

        String text = attached.userLangString(R.string.splash_status_connecting);
        assertEquals("splash text must follow the en cookie, got: " + text,
                "Connecting…", text);

        String rendering = attached.userLangString(R.string.splash_status_rendering);
        assertEquals("Rendering…", rendering);
    }

    @Test
    public void userLangString_zhCookie_returnsChineseSplashText() throws Exception {
        MainActivity attached = Robolectric.buildActivity(MainActivity.class).get();
        setField(attached, "prefs", prefs);
        Field instanceField = MainActivity.class.getDeclaredField("instance");
        instanceField.setAccessible(true);
        instanceField.set(null, attached);

        prefs.edit().putString("server_url", SERVER_URL).commit();
        cookieManager.setCookie(SERVER_URL, "clawbench-locale=zh");

        assertEquals("正在连接…",
                attached.userLangString(R.string.splash_status_connecting));
        assertEquals("正在渲染…",
                attached.userLangString(R.string.splash_status_rendering));
    }

    // --- helpers (mirror MainActivityThemeTest) ---

    @SuppressWarnings("unchecked")
    private static <T> T allocate(Class<T> clazz) throws Exception {
        try {
            Constructor<T> ctor = clazz.getDeclaredConstructor();
            ctor.setAccessible(true);
            return ctor.newInstance();
        } catch (Exception e) {
            var unsafeField = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe");
            unsafeField.setAccessible(true);
            Object unsafe = unsafeField.get(null);
            java.lang.reflect.Method allocate =
                    unsafe.getClass().getDeclaredMethod("allocateInstance", Class.class);
            allocate.setAccessible(true);
            return (T) allocate.invoke(unsafe, clazz);
        }
    }

    private static void setField(Object target, String fieldName, Object value) throws Exception {
        Field field = findField(target.getClass(), fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static Field findField(Class<?> clazz, String fieldName) throws Exception {
        Class<?> c = clazz;
        while (c != null) {
            try {
                return c.getDeclaredField(fieldName);
            } catch (NoSuchFieldException e) {
                c = c.getSuperclass();
            }
        }
        throw new NoSuchFieldException(fieldName);
    }
}
