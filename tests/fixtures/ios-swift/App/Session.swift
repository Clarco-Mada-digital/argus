import Foundation

struct Session {
    func enregistrer(jeton: String, rafraichissement: String) {
        UserDefaults.standard.set(jeton, forKey: "auth_token")
        UserDefaults.standard.set(rafraichissement, forKey: "refresh_token")

        // Correct : une preference d'affichage n'a rien de sensible.
        UserDefaults.standard.set("sombre", forKey: "theme")
        UserDefaults.standard.set(2, forKey: "dernier_onglet")
    }

    func rangerDansTrousseau(jeton: Data) {
        let requete: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: "utilisateur",
            kSecValueData as String: jeton,
            kSecAttrAccessible as String: kSecAttrAccessibleAlways,
        ]
        SecItemAdd(requete as CFDictionary, nil)
    }
}
