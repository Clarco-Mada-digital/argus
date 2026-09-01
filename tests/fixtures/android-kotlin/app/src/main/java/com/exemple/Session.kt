package com.exemple

import android.content.Context
import android.content.SharedPreferences

class Session(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("session", Context.MODE_PRIVATE)

    fun enregistrer(jeton: String, rafraichissement: String) {
        prefs.edit()
            .putString("auth_token", jeton)
            .putString("refresh_token", rafraichissement)
            .apply()
    }

    // Correct : une preference d'affichage n'a rien de sensible.
    fun choisirTheme(theme: String) {
        prefs.edit().putString("theme", theme).apply()
        prefs.edit().putInt("dernier_onglet", 2).apply()
    }
}
