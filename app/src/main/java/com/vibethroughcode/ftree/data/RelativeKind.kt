package com.vibethroughcode.ftree.data

/**
 * A relationship as the user thinks of it, from one person's point of view.
 *
 * Distinct from [RelationshipType], which is how an edge is *stored*: "add a parent" and "add a
 * child" both write a PARENT edge, differing only in direction. Keeping the two apart means the UI
 * can speak in family terms while the graph stays minimal.
 */
enum class RelativeKind {
    PARENT,
    SPOUSE,
    CHILD,
    SIBLING,
}
