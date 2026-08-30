package com.vibethroughcode.ftree.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [Person::class, Relationship::class, PersonOrigin::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class FTreeDatabase : RoomDatabase() {

    abstract fun personDao(): PersonDao
    abstract fun relationshipDao(): RelationshipDao
    abstract fun personOriginDao(): PersonOriginDao

    companion object {
        private const val NAME = "f-tree.db"

        /**
         * Foreign keys are off by default in SQLite, and the ON DELETE CASCADE rules are the only
         * thing stopping a hard delete from leaving orphaned edges behind. Exposed so tests build
         * their in-memory database with exactly the same guarantees as the real one.
         */
        val enforceForeignKeys = object : Callback() {
            override fun onOpen(db: SupportSQLiteDatabase) {
                db.execSQL("PRAGMA foreign_keys=ON")
            }
        }

        fun build(context: Context): FTreeDatabase =
            Room.databaseBuilder(context.applicationContext, FTreeDatabase::class.java, NAME)
                .addCallback(enforceForeignKeys)
                .build()
    }
}
