package com.exemple

import android.webkit.WebView

class Navigateur(vue: WebView) {
    init {
        vue.settings.javaScriptEnabled = true
        vue.settings.allowFileAccess = true
        vue.settings.allowUniversalAccessFromFileURLs = true
    }
}
