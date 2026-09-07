package com.vibethroughcode.ftree.transfer

import androidx.core.content.FileProvider

/**
 * The provider that hands a shared branch to another app.
 *
 * It exists only to have a different class name from the updater's provider. Two `<provider>`
 * entries naming the same class are one component to Android, so a URI minted for this authority
 * arrived at the updater's provider and was refused — which the round-trip test caught the first
 * time it ran. A subclass each keeps the two apart, and keeps their directories apart with them.
 */
class ShareFileProvider : FileProvider()
