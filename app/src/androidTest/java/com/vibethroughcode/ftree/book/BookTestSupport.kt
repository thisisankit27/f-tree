package com.vibethroughcode.ftree.book

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import java.io.File
import kotlin.math.abs

/* What the book's device tests share: a stand-in portrait, comparing pages, keeping them to look at. */

/** A portrait to print where a family's photograph would be: a face-coloured disc on blue. */
internal fun portrait(): Bitmap = Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888).apply {
    val c = Canvas(this)
    c.drawColor(Color.rgb(90, 120, 160))
    c.drawCircle(100f, 80f, 40f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(230, 200, 170) })
    setHasAlpha(false)
}

/** Mean absolute difference per channel, 0-255. Anti-aliasing alone stays well under 6. */
internal fun meanDifference(a: Bitmap, b: Bitmap): Double {
    var total = 0L
    var n = 0L
    val step = 3
    for (y in 0 until a.height step step) for (x in 0 until a.width step step) {
        val p = a.getPixel(x, y)
        val q = b.getPixel(x, y)
        total += abs(Color.red(p) - Color.red(q)) + abs(Color.green(p) - Color.green(q)) + abs(Color.blue(p) - Color.blue(q))
        n += 3
    }
    return total.toDouble() / n
}

/** Kept for a human to look at: `adb pull` the files from the app's external files dir. */
internal fun save(context: Context, bitmap: Bitmap, name: String) {
    val dir = context.getExternalFilesDir(null) ?: return
    File(dir, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
}
