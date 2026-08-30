package com.vibethroughcode.ftree.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import com.vibethroughcode.ftree.R

/*
 * Counts are read out loud in this app — "2 people and 1 connection" — so they are composed from
 * pluralised fragments rather than interpolated as bare numbers. A tree of one should never say
 * "1 people".
 */

@Composable
fun peopleCount(count: Int): String = pluralStringResource(R.plurals.person_count, count, count)

@Composable
fun connectionCount(count: Int): String =
    pluralStringResource(R.plurals.connection_count, count, count)

@Composable
fun photoCount(count: Int): String = pluralStringResource(R.plurals.photo_count, count, count)
