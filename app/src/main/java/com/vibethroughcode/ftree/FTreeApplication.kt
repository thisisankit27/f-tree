package com.vibethroughcode.ftree

import android.app.Application

class FTreeApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
