import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

const apiToken = "ghp_EXEMPLE00000000000000000000000000000";

final router = GoRouter(routes: [
  GoRoute(path: '/', builder: (c, s) => HomePage()),
  GoRoute(path: '/profil', builder: (c, s) => ProfilPage()),
  GoRoute(path: '/parametres', builder: (c, s) => SettingsPage()),
]);

class HomePage extends StatelessWidget {
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () => context.go('/profil'),
      child: Text('Profil'),
    );
  }
}
