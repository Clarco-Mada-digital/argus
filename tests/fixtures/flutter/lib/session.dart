import 'dart:io';
import 'package:shared_preferences/shared_preferences.dart';

class Session {
  Future<void> enregistrer(String jeton, String rafraichissement) async {
    final prefs = await SharedPreferences.getInstance();
    // Un jeton d'acces dans SharedPreferences : lisible en clair.
    await prefs.setString('auth_token', jeton);
    await prefs.setString('refresh_token', rafraichissement);

    // Correct : une preference d'affichage n'a rien de sensible.
    await prefs.setString('theme', 'sombre');
    await prefs.setInt('dernier_onglet', 2);
  }

  HttpClient client() {
    final client = HttpClient();
    client.badCertificateCallback = (cert, host, port) => true;
    return client;
  }
}
