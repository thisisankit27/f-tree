# --- Enum names are data ---------------------------------------------------------------------
#
# Gender, RelationshipType and RelativeKind are persisted *by name*: in the database, in exported
# .ftree files, and (for RelativeKind) inside a navigation route that Navigation resolves by fully
# qualified class name. If R8 renames any of them, previously stored values stop matching and an
# exported file becomes unreadable — a silent data-loss bug that only appears in release builds.
#
# Found the hard way: the first signed build crashed on launch with
# "Cannot find class with name com.vibethroughcode.ftree.data.RelativeKind".
-keep class com.vibethroughcode.ftree.data.Gender { *; }
-keep class com.vibethroughcode.ftree.data.RelationshipType { *; }
-keep class com.vibethroughcode.ftree.data.RelativeKind { *; }
-keep class com.vibethroughcode.ftree.data.ParentKind { *; }
-keep class com.vibethroughcode.ftree.data.SpouseKind { *; }
-keep class com.vibethroughcode.ftree.data.SiblingKind { *; }
-keep class com.vibethroughcode.ftree.data.DeletionMode { *; }

-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# --- kotlinx-serialization -------------------------------------------------------------------
#
# A @Serializable class gets a companion `serializer()` that is looked up reflectively. R8 cannot
# see that use, so without these the export format would fail to serialise in a release build while
# working perfectly in debug.
-keepattributes *Annotation*, InnerClasses, Signature
-dontnote kotlinx.serialization.**

-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}

# The export document and the navigation routes are both serialized by type.
-keep class com.vibethroughcode.ftree.transfer.** { *; }
-keep class com.vibethroughcode.ftree.ui.*Route { *; }
-keep class com.vibethroughcode.ftree.ui.*Route$* { *; }
