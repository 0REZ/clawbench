package com.clawbench.app;

import java.util.HashMap;
import java.util.Map;

/**
 * Chinese (zh) resource texts for MainActivity's connection/login error keys,
 * used by unit tests that spy MainActivity via Unsafe.allocateInstance (no
 * attached Context, so getString() cannot resolve resources). Keeping the
 * texts here mirrors values-zh/strings.xml so the assertions match the real
 * zh strings without needing a Robolectric environment.
 */
final class MainActivityZhText {

    private static final Map<Integer, String> MAP = new HashMap<>();

    static {
        MAP.put(R.string.conn_file_picker_title, "选择文件");
        MAP.put(R.string.conn_timeout, "连接超时，请检查服务器地址和网络连接。");
        MAP.put(R.string.conn_no_network, "网络不可用，请检查网络连接。");
        MAP.put(R.string.conn_ssl_title, "SSL 证书验证失败");
        MAP.put(R.string.conn_ssl_message, "服务器使用了自签名证书，连接可能不安全。\n\n仅当您信任该服务器时才继续。");
        MAP.put(R.string.conn_ssl_positive, "信任并继续");
        MAP.put(R.string.conn_ssl_negative, "取消连接");
        MAP.put(R.string.conn_err_dns, "无法解析服务器地址，请检查域名是否正确。");
        MAP.put(R.string.conn_err_unreachable, "无法连接到服务器，请检查地址和端口。");
        MAP.put(R.string.conn_err_timeout, "连接超时，请检查服务器地址和网络连接。");
        MAP.put(R.string.conn_err_network, "网络错误，请检查网络连接。");
        MAP.put(R.string.conn_err_connect, "无法连接到服务器，请检查地址和网络连接。");
        MAP.put(R.string.conn_err_not_clawbench, "该地址不是 ClawBench 服务器。");
        MAP.put(R.string.conn_err_password, "密码错误，请检查登录密码。");
        MAP.put(R.string.conn_err_rate_limited, "尝试次数过多，请稍后再试。");
        MAP.put(R.string.conn_err_server, "服务器错误 (%1$d)，请稍后重试。");
        MAP.put(R.string.conn_err_bad_status, "连接失败 (%1$d)，请检查服务器地址。");
        MAP.put(R.string.conn_ssl_exception, "SSL 连接异常，请重新连接。");
        MAP.put(R.string.conn_err_load, "无法连接到服务器，请检查地址和网络连接。");
        MAP.put(R.string.conn_err_auth, "认证失败，请检查密码是否正确。");
        MAP.put(R.string.conn_err_request, "请求错误 (%1$d)，请检查服务器地址。");
        MAP.put(R.string.conn_err_http_failed, "连接失败，请检查服务器地址和网络连接。");
        MAP.put(R.string.conn_render_crash, "页面渲染异常，请重新连接。");
    }

    private MainActivityZhText() {
    }

    /** The zh text for a MainActivity error resource id, or null if unmapped. */
    static String get(int resId) {
        return MAP.get(resId);
    }
}
