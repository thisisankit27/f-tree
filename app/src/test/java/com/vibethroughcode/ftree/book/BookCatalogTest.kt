package com.vibethroughcode.ftree.book

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `BookCatalog` held to `site/book/catalog-cases.json`, the table `catalog.test.mjs` reads too, so
 * the two shells can never feature different templates on the same day. `app/build.gradle.kts`
 * declares the table, the shipped catalogue and `template.js` as inputs to this task.
 */
class BookCatalogTest {

    private val shipped = File(repoRoot, "site/book/templates/catalog.json").readText()

    @Test
    fun `every case in catalog-cases json lists the same way in Kotlin as in JavaScript`() {
        val table = Json.parseToJsonElement(File(repoRoot, "site/book/catalog-cases.json").readText()).jsonObject
        assertEquals(1, table.getValue("format").jsonPrimitive.int)
        for (case in table.getValue("cases").jsonArray.map { it.jsonObject }) {
            val name = case.getValue("name").jsonPrimitive.content
            val given = case.getValue("catalog")
            val catalog = if (given is JsonPrimitive && given.content == "shipped") BookCatalog.read(shipped) else BookCatalog.read(given)
            val today = case.getValue("today").jsonPrimitive.content
            val supported = case.getValue("supported").jsonPrimitive.int
            val expect = case.getValue("expect").jsonObject
            val ids = { key: String -> expect.getValue(key).jsonArray.map { it.jsonPrimitive.content } }

            assertEquals(name, ids("listed"), BookCatalog.listing(catalog, today, supported).map { it.id })
            assertEquals(name, ids("featured"), BookCatalog.featuredAt(catalog, today, supported))
            val opening = expect.getValue("opening").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(name, opening, BookCatalog.opening(catalog, today, supported))
        }
    }

    @Test
    fun `the template format it gates on is the one the staged composer reads`() {
        val js = File(repoRoot, "site/book/template.js").readText()
        val format = Regex("export const TEMPLATE_FORMAT = (\\d+);").find(js)?.groupValues?.get(1)?.toInt()
        assertEquals(format, BookCatalog.TEMPLATE_FORMAT)
    }

    @Test
    fun `the shipped catalogue is read whole`() {
        val raw = Json.parseToJsonElement(shipped).jsonObject.getValue("templates").jsonArray
        assertEquals(raw.map { (it as JsonObject).getValue("id").jsonPrimitive.content }, BookCatalog.read(shipped)?.map { it.id })
    }

    @Test
    fun `nonsense is unreadable, never a crash`() {
        for (bad in listOf("{not json", "[]", "\"text\"", "42", "{\"format\":1,\"templates\":\"x\"}")) {
            assertEquals(bad, null, BookCatalog.read(bad))
        }
        assertEquals(null, BookCatalog.opening(null, "2026-01-01"))
    }
}
