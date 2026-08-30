package com.vibethroughcode.ftree.ui

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.vibethroughcode.ftree.ui.people.PeopleScreen
import com.vibethroughcode.ftree.ui.person.PersonDetailScreen
import com.vibethroughcode.ftree.ui.person.PersonEditScreen
import com.vibethroughcode.ftree.ui.transfer.AboutScreen
import com.vibethroughcode.ftree.ui.tree.TreeScreen
import com.vibethroughcode.ftree.ui.relative.AddRelativeScreen

@Composable
fun FTreeApp() {
    val navController = rememberNavController()

    NavHost(navController = navController, startDestination = TreeRoute) {
        composable<TreeRoute> {
            TreeScreen(
                onOpenPerson = { navController.navigate(PersonRoute(it)) },
                onOpenPeople = { navController.navigate(PeopleRoute) },
                onAddPerson = { navController.navigate(EditPersonRoute()) },
                onAddRelative = { anchorId, kind ->
                    navController.navigate(AddRelativeRoute(anchorId, kind))
                },
                onAbout = { navController.navigate(AboutRoute) },
            )
        }

        composable<AboutRoute> {
            AboutScreen(onBack = { navController.popBackStack() })
        }

        composable<PeopleRoute> {
            PeopleScreen(
                onOpenPerson = { navController.navigate(PersonRoute(it)) },
                onAddPerson = { navController.navigate(EditPersonRoute()) },
            )
        }

        composable<PersonRoute> {
            PersonDetailScreen(
                onBack = { navController.popBackStack() },
                onEdit = { navController.navigate(EditPersonRoute(it)) },
                onOpenPerson = { navController.navigate(PersonRoute(it)) },
                onAddRelative = { anchorId, kind ->
                    navController.navigate(AddRelativeRoute(anchorId, kind))
                },
            )
        }

        composable<AddRelativeRoute> {
            AddRelativeScreen(onBack = { navController.popBackStack() })
        }

        composable<EditPersonRoute> { entry ->
            val route = entry.toRoute<EditPersonRoute>()
            PersonEditScreen(
                onBack = { navController.popBackStack() },
                onSaved = { personId ->
                    if (route.personId == null) {
                        // A newly added person opens straight onto their own page, which is where
                        // the next thing you want to do — add a relative — lives. Only the form is
                        // dropped from the back stack, so going back returns to wherever the add
                        // started rather than always to the chart.
                        navController.navigate(PersonRoute(personId)) {
                            popUpTo<EditPersonRoute> { inclusive = true }
                        }
                    } else {
                        navController.popBackStack()
                    }
                },
            )
        }
    }
}
