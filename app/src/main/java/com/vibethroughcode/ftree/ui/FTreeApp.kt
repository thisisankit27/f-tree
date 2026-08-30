package com.vibethroughcode.ftree.ui

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.vibethroughcode.ftree.ui.people.PeopleScreen
import com.vibethroughcode.ftree.ui.person.PersonDetailScreen
import com.vibethroughcode.ftree.ui.person.PersonEditScreen
import com.vibethroughcode.ftree.ui.relative.AddRelativeScreen

@Composable
fun FTreeApp() {
    val navController = rememberNavController()

    NavHost(navController = navController, startDestination = PeopleRoute) {
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
                        // the next thing you want to do — add a relative — will live.
                        navController.navigate(PersonRoute(personId)) {
                            popUpTo(PeopleRoute)
                        }
                    } else {
                        navController.popBackStack()
                    }
                },
            )
        }
    }
}
