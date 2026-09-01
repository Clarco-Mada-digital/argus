package com.exemple

import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

object Reseau {
    private val toutAccepter = object : X509TrustManager {
        override fun checkClientTrusted(chaine: Array<X509Certificate>, type: String) {}
        override fun checkServerTrusted(chaine: Array<X509Certificate>, type: String) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }

    fun configurer() {
        val contexte = SSLContext.getInstance("TLS")
        contexte.init(null, arrayOf(toutAccepter), java.security.SecureRandom())
        javax.net.ssl.HttpsURLConnection.setDefaultHostnameVerifier(HostnameVerifier { _, _ -> true })
    }
}
