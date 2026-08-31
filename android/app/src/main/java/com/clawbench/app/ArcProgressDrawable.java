package com.clawbench.app;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;

/**
 * A small ring-arc drawable used as the "running" loading indicator in the
 * floating status capsule. Draws a full background ring (the foreground color
 * at low opacity) plus a short foreground arc (90°) with a round cap; the host
 * view rotates it continuously while any session is running, producing a
 * spinner-like loading effect with a visible track.
 */
public class ArcProgressDrawable extends Drawable {

    private static final int SWEEP_DEGREES = 90;
    private static final float STROKE_FRACTION = 0.16f;
    /** Track (background ring) opacity as a fraction of the arc color. */
    private static final int TRACK_ALPHA = 60;

    private final Paint arcPaint;
    private final Paint trackPaint;
    private final float strokeWidth;

    public ArcProgressDrawable(int color, int sizePx) {
        arcPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        arcPaint.setColor(color);
        arcPaint.setStyle(Paint.Style.STROKE);
        arcPaint.setStrokeCap(Paint.Cap.ROUND);
        strokeWidth = Math.max(1f, sizePx * STROKE_FRACTION);
        arcPaint.setStrokeWidth(strokeWidth);

        trackPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        trackPaint.setColor(color);
        trackPaint.setStyle(Paint.Style.STROKE);
        trackPaint.setAlpha(TRACK_ALPHA);
        trackPaint.setStrokeWidth(strokeWidth);
    }

    public ArcProgressDrawable(int color, float density) {
        this(color, Math.round(12 * density));
    }

    @Override
    public void draw(Canvas canvas) {
        int w = getBounds().width();
        int h = getBounds().height();
        if (w <= 0 || h <= 0) {
            return;
        }
        float pad = strokeWidth / 2f;
        RectF arc = new RectF(pad, pad, w - pad, h - pad);
        // Background track: a full ring at low opacity.
        canvas.drawArc(arc, 0f, 360f, false, trackPaint);
        // Foreground arc: a short segment (rotated by the host view).
        canvas.drawArc(arc, 270f, SWEEP_DEGREES, false, arcPaint);
    }

    @Override
    public void setAlpha(int alpha) {
        arcPaint.setAlpha(alpha);
        trackPaint.setAlpha((int) (alpha * TRACK_ALPHA / 255f));
        invalidateSelf();
    }

    @Override
    public void setColorFilter(android.graphics.ColorFilter colorFilter) {
        arcPaint.setColorFilter(colorFilter);
        trackPaint.setColorFilter(colorFilter);
        invalidateSelf();
    }

    @Override
    public int getOpacity() {
        return Color.TRANSPARENT;
    }
}
