import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, View } from 'react-native';
import { Bouton } from '@monorepo/ui';

export default function Accueil() {
  const connecter = async (jeton: string) => {
    await AsyncStorage.setItem('auth_token', jeton);
  };
  return <View><Text>Bonjour</Text><Bouton titre="Entrer" /></View>;
}
