package com.clawbench.app;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;

/**
 * A small ring-arc drawable used as the "running" loading indicator in the
 * floating status capsule. Draws a partial arc (270°) with a round cap; the
 * host view rotates it continuously while any session is running, producing
 * a spinner-like loading effect.
 */
public class ArcProgressDrawable extends Drawable {

    private static final int SWEEP_DEGREES = 270;
    private static final float STROKE_FRACTION = 0.22f;

    private final Paint paint;
    private final float strokeWidth;

    public ArcProgressDrawable(int color, int sizePx) {
        paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(color);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        strokeWidth = Math.max(1f, sizePx * STROKE_FRACTION);
        paint.setStrokeWidth(strokeWidth);
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
        canvas.drawArc(arc, 270f, SWEEP_DEGREES, false, paint);
    }

    @Override
    public void setAlpha(int alpha) {
        paint.setAlpha(alpha);
        invalidateSelf();
    }

    @Override
    public void setColorFilter(android.graphics.ColorFilter colorFilter) {
        paint.setColorFilter(colorFilter);
        invalidateSelf();
    }

    @Override
    public int getOpacity() {
        return Color.TRANSPARENT;
    }
}
