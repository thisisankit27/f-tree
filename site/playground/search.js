/*
 * Finding a person by name, in one place rather than three.
 *
 * The website had this; the desktop had a weaker one of its own, which matched names only, needed
 * two characters before it would answer, and returned people in file order -- so searching a large
 * tree for "an" put whoever happened to be exported first at the top. The relation finder needs two
 * more of these, and three implementations of "find me a person" is how two of them quietly stop
 * agreeing about who is in the file.
 *
 * Pure, over the graph, so it belongs with the graph.
 */

/**
 * People matching `query`, best matches first.
 *
 * The ranking is the useful part. A name that *starts* with what was typed is almost always the one
 * wanted, so those come first and a mid-name match second -- typing "ram" should offer Ram Lal
 * before Sitaram. Then two kinds of match a plain name search would miss:
 *
 *   somebody with no name recorded, findable by typing "unknown" or "unnamed", because they are
 *   drawn that way and there is otherwise no way to search for them at all;
 *
 *   a year, so "1962" finds whoever was born or died then. It is how somebody looks for a person
 *   whose name they cannot spell, and it costs one comparison.
 *
 * Ties break on name so that the same query always gives the same list.
 */
export function searchPeople(graph, query, limit = 14) {
  if (!graph) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits = [];
  for (const person of graph.people.values()) {
    const name = person.name?.toLowerCase() ?? '';
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (name.includes(q)) rank = 1;
    else if (!person.name && ('unknown'.startsWith(q) || 'unnamed'.startsWith(q))) rank = 2;
    else if ((person.birthDate ?? '').startsWith(q) || (person.deathDate ?? '').startsWith(q)) rank = 3;
    if (rank >= 0) hits.push({ person, rank });
  }

  hits.sort((a, b) => a.rank - b.rank
    || (a.person.name ?? '').localeCompare(b.person.name ?? ''));
  return hits.slice(0, limit).map((h) => h.person);
}
