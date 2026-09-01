import { Text, View } from 'react-native';
import { Link } from 'expo-router';

export default function Accueil() {
  return (
    <View>
      <Text>Bonjour</Text>
      <Link href="/profil">Mon profil</Link>
    </View>
  );
}
