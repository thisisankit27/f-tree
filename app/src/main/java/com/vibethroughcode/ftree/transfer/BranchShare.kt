package com.vibethroughcode.ftree.transfer

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.vibethroughcode.ftree.data.FamilyRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * A branch written out and ready to hand to another app.
 *
 * [people] is carried so the message can say how many are in the file. Somebody receiving a
 * document over a chat app has no idea what is in it until they open it, and "4 people" is the
 * difference between a file worth installing an app for and one worth ignoring.
 */
data class SharedBranch(
    val uri: Uri,
    val personName: String?,
    val people: Int,
)

/**
 * Writes one person's branch to a file another app can read.
 *
 * The whole-tree export asks the user where to put the file, because it is their archive and they
 * are keeping it. A share is the opposite: the file is a message, nobody wants to name it, and it
 * should not survive being sent. So it is written to the cache under a name that says what it is,
 * handed over as a content URI for the length of one intent, and the previous one is deleted each
 * time rather than accumulating copies of a family in a temporary directory.
 */
class BranchShare(
    private val context: Context,
    private val repository: FamilyRepository,
    private val exporter: TreeExporter,
) {

    suspend fun prepare(personId: String): SharedBranch? = withContext(Dispatchers.IO) {
        val person = repository.person(personId) ?: return@withContext null
        val branch = repository.branchIdsOf(personId)

        val directory = File(context.cacheDir, DIRECTORY)
        directory.deleteRecursively()
        directory.mkdirs()

        val file = File(directory, fileNameFor(person.name))
        val summary = file.outputStream().use { exporter.exportTo(it, only = branch) }

        SharedBranch(
            uri = FileProvider.getUriForFile(context, "${context.packageName}.$AUTHORITY", file),
            personName = person.name?.takeIf { it.isNotBlank() },
            people = summary.people,
        )
    }

    /**
     * `Sandeep-Kumar-family.ftree`.
     *
     * The name is the only part of a shared file most people will read before deciding whether to
     * open it, so it carries whose family it is. Anything that is not a letter, a digit or a dash
     * goes, because this name has to survive every chat app, file manager and filesystem between
     * here and the person receiving it.
     */
    private fun fileNameFor(name: String?): String {
        val stem = name.orEmpty().trim()
            .replace(Regex("[^\\p{L}\\p{N}]+"), "-")
            .trim('-')
            .take(48)
            .ifBlank { "shared" }
        return "$stem-family.${TreeDocument.FILE_EXTENSION}"
    }

    private companion object {
        const val DIRECTORY = "shared"
        const val AUTHORITY = "shares"
    }
}

/**
 * The intent that carries a branch out of the app.
 *
 * Built here rather than at the call site so that what travels can be asserted. Whether a given
 * chat app *shows* the message beside the document is that app's decision and not something this
 * can guarantee — which is exactly why the file is named after whose family it is. The name is the
 * part that always arrives.
 */
fun sendBranchIntent(uri: Uri, message: String?, subject: String?): Intent =
    Intent(Intent.ACTION_SEND).apply {
        type = TreeDocument.MIME_TYPE
        putExtra(Intent.EXTRA_STREAM, uri)
        message?.let { putExtra(Intent.EXTRA_TEXT, it) }
        subject?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
