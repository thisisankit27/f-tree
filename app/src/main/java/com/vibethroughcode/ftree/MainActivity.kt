package com.vibethroughcode.ftree

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.vibethroughcode.ftree.ui.FTreeApp
import com.vibethroughcode.ftree.ui.theme.FTreeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            FTreeTheme {
                FTreeApp()
            }
        }
    }
}
