import 'package:flutter/material.dart';
import 'session.dart';

void main() => runApp(const MonApplication());

class MonApplication extends StatelessWidget {
  const MonApplication({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Application',
      home: Scaffold(body: Center(child: Text('Bonjour'))),
    );
  }
}
